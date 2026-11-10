# 资源来源与使用说明 / Asset provenance and usage

[中文 README](README.md) · [English README](README.en.md) · [Apache-2.0](LICENSE)

## 中文

### 许可范围

本项目原创代码、文档，以及贡献者有权许可的原创 SVG 和 AI 生成成果，按 Apache License 2.0 提供。第三方素材、字体和依赖不因进入本仓库而改用 Apache-2.0；其权利仍归原权利人，并受各自条款约束。此说明不改变 Apache-2.0 原文，也不为来源未明确的素材补授许可。

本仓库包含网上收集／第三方导入的图片，也包含 AI 生成图片。**现有校验清单记录文件路径、尺寸或哈希，不是版权归属或使用授权的证明。** 对尚未核实的作者、原始来源和许可证，不作已获授权的承诺，也不能将其理解为公有领域。

### 现有资源

| 资源与路径 | 已知来源 | 记录与许可状态 |
| --- | --- | --- |
| 基础宠物图：`public/pets/` 中除下述生肖外的 47 种、376 张阶段图 | 网上收集／第三方导入，未由本项目生成或重绘 | [文件清单](public/pets/image-manifest.csv)；逐项作者、原始网址和授权证明尚不完整，使用前需核实 |
| 宠物蛋：`public/pets/egg.webp` | 第三方导入 | [来源说明](public/pets/SOURCES.md)；使用及再分发许可待核实 |
| `public/pets/zodiac-rat/`、`zodiac-ox/`、`zodiac-snake/`，共 24 张成长图 | Codex 原生图片工具生成，部分参考既有宠物图；后续裁切与透明底处理 | [生成与导出记录](public/pets/zodiac-generation-manifest.json)；保留 AI 来源说明，核对参考素材权利与工具条款 |
| `public/badges/lv2.png` 至 `lv8.png` | AI 生成的等级徽章 | [生成清单](public/badges/manifest.json)；工具未披露具体模型，不作模型名称推断 |
| `public/pet-backgrounds/`，41 个 SVG 场景 | 为本项目创作的矢量背景 | [场景目录与来源](public/pets/SOURCES.md)；项目原创部分按 Apache-2.0 提供 |
| `public/fonts/` | Nunito、ZCOOL KuaiLe | [字体来源](public/fonts/SOURCES.md)；分别遵循目录中的 SIL Open Font License |
| `docs/screenshots/` | 本地运行产品后截取，使用内置演示班级与虚构账号 | 截图包含上述图片；截图不改变其中素材的许可，不含真实学生资料 |

原始评价规则中也有第三方导入内容；翻译和项目新增内容的许可不替代原始内容的权利核验。第三方程序库与图标遵循各自发布的许可证。

### 在其他项目中使用

- 保留所使用资源的来源、已有版权和许可说明；修改资源时记录改动，不将第三方图或 AI 图标注为本人手绘原创。
- 对授权不明确的图片，先取得权利人许可，或替换为自有／明确获授权的素材，再公开部署、用于商业产品或再次分发。仓库可下载不等于已获上述授权。
- AI 生成不保证不存在第三方权利；若使用参考图片、角色形象或商标，应另行核对相关权利和生成工具条款。这里不作“全部可商用”或“无版权风险”的承诺。
- 新增素材时补充作者／来源链接、许可依据；AI 素材另记生成工具、日期、参考输入、提示词和处理步骤。不得把密钥或私人数据写入清单。

如需补充署名、反馈授权问题或请求替换／移除，请在 [GitHub Issues](https://github.com/anthonyli/pet-bloom/issues) 提供具体文件路径、原始来源和权属依据。不要在公开 issue 中上传敏感个人资料。

## English

### License scope

Original code, documentation, and original SVG or AI-generated contributions are provided under Apache License 2.0 to the extent contributors hold the rights to license them. Third-party artwork, fonts and dependencies retain their own rights and terms. Inclusion in this repository does not relicense them under Apache-2.0. This document neither changes the Apache license nor grants missing permissions for third-party materials.

The repository includes both artwork collected online / imported from third parties and AI-generated images. **File paths, dimensions and checksums establish file identity, not copyright ownership or permission.** Missing authorship, source or license information must not be interpreted as permission or public-domain status.

### Asset inventory

| Assets | Known origin | Records and status |
| --- | --- | --- |
| 376 base growth images for 47 pets in `public/pets/`, excluding the zodiac additions below | Collected online / imported from third parties; not generated or redrawn by this project | [File manifest](public/pets/image-manifest.csv); complete per-asset authors, original URLs and permission evidence are not yet recorded |
| `public/pets/egg.webp` | Imported third-party placeholder | [Provenance notes](public/pets/SOURCES.md); usage and redistribution permissions require verification |
| 24 growth images in `public/pets/zodiac-rat/`, `zodiac-ox/` and `zodiac-snake/` | Generated with Codex's native image tool, partly referencing existing pet artwork; subsequently cropped and processed for transparency | [Generation and export manifest](public/pets/zodiac-generation-manifest.json); retain AI provenance and verify reference rights and tool terms |
| `public/badges/lv2.png` through `lv8.png` | AI-generated level badges | [Generation manifest](public/badges/manifest.json); the tool did not disclose the underlying model |
| 41 SVG scenes in `public/pet-backgrounds/` | Vector backgrounds created for this project | [Catalog and provenance](public/pets/SOURCES.md); original project contributions are provided under Apache-2.0 |
| `public/fonts/` | Nunito and ZCOOL KuaiLe | [Font sources](public/fonts/SOURCES.md); each font includes its SIL Open Font License |
| `docs/screenshots/` | Captured from the running local app with built-in demo classes and fictional accounts | Includes the artwork above; screenshots do not change embedded asset licenses and contain no real student records |

Some original evaluation rules were also imported from third parties. Licensing translations or newly added content does not replace verification of rights in the original material. Third-party libraries and icons retain their published licenses.

### Reusing assets

- Keep source, copyright and license notices with reused assets. Record modifications, and do not describe third-party or AI-generated images as your own hand-drawn originals.
- Obtain permission for unclear assets, or replace them with your own or explicitly licensed artwork before public deployment, commercial use or redistribution. Public availability alone does not grant those rights.
- AI generation is not a guarantee against third-party rights. Check reference images, character designs, trademarks and the applicable tool terms. No blanket commercial clearance or non-infringement guarantee is made here.
- For additions, record the creator, source URL and license evidence. For AI assets, also record the tool, date, reference inputs, prompts and processing steps. Keep secrets and private data out of manifests.

For attribution corrections, permission concerns, or replacement/removal requests, open a [GitHub issue](https://github.com/anthonyli/pet-bloom/issues) with the affected path, original source and evidence of ownership. Do not upload sensitive personal information to public issues.
