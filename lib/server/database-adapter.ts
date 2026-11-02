import { resolve } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import type Database from 'better-sqlite3'
import type { Client, InStatement, Transaction } from '@libsql/client'

type Context = { transaction?: Transaction; failed: boolean; active: boolean }
export type Statement = { sql: string; args: (string | number | bigint | null | Uint8Array)[] }
const fileQueues = new Map<string, { tail: Promise<unknown> }>()
const localAdapters = new WeakMap<Database.Database, ApplicationDatabase>()

/** Async business interface. Local connections are serialized, including reads,
 * so another request cannot accidentally execute inside an open transaction. */
export class ApplicationDatabase {
  private context = new AsyncLocalStorage<Context>()
  private queue = { tail: Promise.resolve() as Promise<unknown> }
  constructor(private local?: Database.Database, private remote?: Client) {
    if (local && local.name !== ':memory:') {
      const key = resolve(local.name)
      this.queue = fileQueues.get(key) || this.queue
      fileQueues.set(key, this.queue)
    }
  }
  get inTransaction() { return this.local?.inTransaction ?? Boolean(this.context.getStore()?.active) }
  get kind() { return this.remote ? 'turso' : 'sqlite' }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue.tail
    let release!: () => void
    this.queue.tail = new Promise<void>(resolve => { release = resolve })
    await previous
    try { return await fn() } finally { release() }
  }
  private async access<T>(fn: (context?: Context) => Promise<T>): Promise<T> {
    const context = this.context.getStore()
    if (context && !context.active) throw new Error('Transaction already finished')
    if (context || this.remote) return fn(context)
    return this.exclusive(() => fn())
  }
  prepare(sql: string) {
    const execute = (args: unknown[], mode: 'get' | 'all' | 'run') => this.access(async context => {
      if (this.local) {
        const statement = this.local.prepare(sql)
        return statement[mode](...args)
      }
      const result = await (context?.transaction || this.remote!).execute({ sql, args: args as Statement['args'] })
      if (mode === 'run') return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid ?? 0n }
      const rows = result.rows.map(row => ({ ...row }))
      return mode === 'get' ? rows[0] : rows
    })
    return {
      get: (...args: unknown[]): Promise<unknown> => execute(args, 'get'),
      all: (...args: unknown[]): Promise<unknown[]> => execute(args, 'all') as Promise<unknown[]>,
      run: (...args: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> => execute(args, 'run') as Promise<{ changes: number; lastInsertRowid: number | bigint }>
    }
  }
  async batch(statements: Statement[]) {
    if (!statements.length) return
    await this.transaction(async () => {
      const context = this.context.getStore()!
      if (this.local) for (const statement of statements) this.local.prepare(statement.sql).run(...statement.args)
      else {
        // Limit request size while retaining one transaction across all chunks.
        let chunk: InStatement[] = [], bytes = 0
        for (const statement of statements) {
          const size = Buffer.byteLength(JSON.stringify(statement, (_, value) => typeof value === 'bigint' ? String(value) : value))
          if (chunk.length && (chunk.length >= 100 || bytes + size > 1024 * 1024)) {
            await context.transaction!.batch(chunk); chunk = []; bytes = 0
          }
          chunk.push(statement); bytes += size
        }
        if (chunk.length) await context.transaction!.batch(chunk)
      }
    })()
  }
  transaction<T>(fn: () => T | Promise<T>) {
    const run = async (mode: 'write' | 'read'): Promise<T> => {
      const parent = this.context.getStore()
      if (parent) {
        if (!parent.active) throw new Error('Transaction already finished')
        try { return await fn() } catch (error) { parent.failed = true; throw error }
      }
      const execute = async () => {
        const transaction = this.remote ? await this.remote.transaction(mode) : undefined
        const context: Context = { transaction, failed: false, active: true }
        if (this.local) this.local.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN DEFERRED')
        try {
          const result = await this.context.run(context, fn)
          if (context.failed) throw new Error('Nested transaction failed')
          if (transaction) await transaction.commit()
          else this.local!.exec('COMMIT')
          return result
        } catch (error) {
          try { if (transaction) await transaction.rollback(); else this.local!.exec('ROLLBACK') } catch { /* preserve original failure */ }
          throw error
        } finally { context.active = false; transaction?.close() }
      }
      return this.local ? this.exclusive(execute) : execute()
    }
    return Object.assign(() => run('write'), { immediate: () => run('write'), deferred: () => run('read') })
  }
  async exec(sql: string) {
    await this.access(async context => {
      if (this.local) this.local.exec(sql)
      else await (context?.transaction || this.remote!).executeMultiple(sql)
    })
  }
  async pragma(sql: string, options?: { simple?: boolean }) {
    return this.access(async () => {
      if (!this.local) throw new Error('SQLite pragmas are local-only')
      return this.local.pragma(sql, options)
    })
  }
  close() { this.local?.close(); this.remote?.close() }
}

export function adaptDatabase(database: Database.Database | ApplicationDatabase) {
  if (database instanceof ApplicationDatabase) return database
  let adapter = localAdapters.get(database)
  if (!adapter) { adapter = new ApplicationDatabase(database); localAdapters.set(database, adapter) }
  return adapter
}
