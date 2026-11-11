---
name: PetBloom · 萌芽
description: 以学生宠物成长为内容、以教师评价为操作的中英文班级工作台。
colors:
  primary: "#6d4aff"
  primary-hover: "#5937dd"
  ink: "#26233b"
  muted: "#6e6a80"
  line: "#e9e6f1"
  canvas: "#f7f7fb"
  white: "#ffffff"
  success: "#16784a"
  danger: "#c53c51"
  danger-surface: "#fff0f2"
  danger-hover: "#ffe0e6"
  secondary-hover: "#f9f7ff"
  secondary-hover-line: "#cfc5ec"
  ghost-hover: "#eeebf5"
  field-line: "#dcd8e6"
  field-placeholder: "#797487"
  field-focus: "#e1dbff"
  field-disabled: "#f1eff5"
  tab-track: "#f0edf7"
  pet-surface: "#fbfaff"
  growth-track: "#ece7fa"
  level-ink: "#655183"
  level-line: "#e5ddf5"
  badge-surface: "#fff0c4"
  badge-ink: "#795c1c"
  select-highlight: "#f0ebff"
  select-focus: "#dcd3fa"
  score-positive: "#7540d5"
  score-negative: "#bf3f58"
  celebration-title: "#ffdc80"
  celebration-emphasis: "#ffdf82"
  celebration-frame: "#ffda76"
  celebration-action: "#ffe3a0"
  celebration-action-ink: "#503715"
  celebration-foreground: "#fff9e9"
  celebration-ray: "#f1ca67"
  celebration-level: "#cc5b30"
typography:
  celebration-headline:
    fontFamily: "'Garden Nunito', 'Garden KuaiLe', sans-serif"
    fontSize: "clamp(40px, 6vw, 76px)"
    lineHeight: 1.12
  display-en:
    fontFamily: "'Garden Nunito', 'Garden KuaiLe', sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  display-zh:
    fontFamily: "'Garden Nunito', 'Garden KuaiLe', sans-serif"
    fontSize: "2.25rem"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline-auth:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  headline-desktop:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: "1.75rem"
  body:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  body-small:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
  caption:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  3xl: "24px"
  full: "9999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  7: "28px"
  8: "32px"
  9: "36px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "8px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.ghost-hover}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "8px 16px"
  button-danger-hover:
    backgroundColor: "{colors.danger-hover}"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.body-small}"
    rounded: "{rounded.xl}"
    padding: "10px 12px"
    width: "100%"
  select-trigger:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.body-small}"
    rounded: "{rounded.xl}"
    padding: "10px 12px"
    width: "100%"
  select-item:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  select-item-highlighted:
    backgroundColor: "{colors.select-highlight}"
    textColor: "{colors.primary}"
  checkbox:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.md}"
    size: "20px"
  checkbox-checked:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
  celebration-continue:
    backgroundColor: "{colors.celebration-action}"
    textColor: "{colors.celebration-action-ink}"
    rounded: "{rounded.xl}"
    padding: "11px 24px"
  celebration-level:
    backgroundColor: "{colors.celebration-level}"
    textColor: "{colors.celebration-foreground}"
    rounded: "{rounded.full}"
    size: "86px"
  pet-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
  tab:
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
  tab-active:
    backgroundColor: "{colors.white}"
    textColor: "{colors.primary}"
  level-chip:
    backgroundColor: "{colors.white}"
    textColor: "{colors.level-ink}"
    rounded: "{rounded.full}"
    height: "28px"
    padding: "0 10px"
  dialog:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.3xl}"
    padding: "20px"
  growth-bar:
    backgroundColor: "{colors.growth-track}"
    rounded: "{rounded.full}"
    height: "6px"
---

# Design System: PetBloom · 萌芽

## Overview

**Creative North Star: "班级宠物工作台"**

明亮、温和而以操作为先。用户已经选择班级宠物工作台方向：学生与真实宠物图片是内容，紫色把评价、添加和选中状态连起来。白色表面置于浅紫灰底上，以细边框、柔和圆角和低阴影维持教室工作台的清晰度；不将本次界面改造成另一种视觉世界。

中文与英文共用组件、布局和语义色。功能界面使用系统无衬线字体；登录插画区及全屏升级/毕业标题使用本地展示字体，让宠物的亲和力留在内容与入口，而不影响教师持续操作的可读性。此记录依据当前代码及提供的新旧截图增量更新，不是新一轮完成度审查。此前 ship 仅覆盖上一轮五项修复，不代表本轮新增需求已复审。

**Key Characteristics:**
- 浅紫灰画布、白色容器、紫色操作与成长反馈。
- 紧凑的功能排版、细描边和柔和低阴影。
- 真实 WebP 宠物素材、统一 Lucide 线性图标。
- 中英文共用布局，手机保留两列学生卡片。
- Radix Select / Checkbox / Dialog 统一交互；金色全屏庆祝与局部飘分尊重 reduced-motion。

## Colors

单一紫色主强调配以带紫调的中性色，绿、红和琥珀承载相应的业务语义，金色层限定于事件庆祝；规范数值见 frontmatter。

### Primary
- **成长紫（primary）**：主要操作、积分、成长条、选中状态、焦点和品牌标记；primary-hover 用于主要按钮悬停。

### Secondary
- **正向绿（success）**：评价规则加分与成功状态；不是第二套品牌操作色。
- **警示红（danger）**：负向积分、错误与危险操作；危险按钮使用浅红表面及其悬停色。
- **徽章琥珀（badge-surface / badge-ink）**：毕业徽章的底色与文字。
- **庆祝金色层（celebration-*）**：仅全屏升级/毕业的标题、光束、相框、等级和继续按钮，不替换工作台紫色操作。
- **局部飘分（score-positive / score-negative）**：加分紫、减分红；正向辅以心形/星形，不强行套用评价规则绿字。

### Neutral
- **紫灰画布（canvas）** 与 **白色表面（white）**：工作区及其卡片、表单和浮层。
- **深紫墨（ink）** 与 **柔紫灰（muted）**：主要文字与辅助文字。字段占位文字有独立的 field-placeholder。
- **浅紫线（line）**：容器与分隔；字段使用 field-line，聚焦使用 field-focus；字段禁用使用 field-disabled。
- **交互浅层**：secondary-hover / secondary-hover-line、ghost-hover 与 tab-track 分别用于次按钮、幽灵按钮和分类标签轨道。
- **宠物浅底（pet-surface）** 与 **成长轨道（growth-track）**：图片区和进度槽。等级胶囊使用 level-ink / level-line。

### Named Rules
**The Semantic Accent Rule.** 紫色连接操作和成长；绿、红、琥珀保留成功、负向与徽章含义。局部加分用紫色飘分，全屏升级/毕业允许金色庆祝层；状态同时用文字、数值或图标表达。

## Typography

**Display Font:** 本地 Garden Nunito（Nunito 800）与 Garden KuaiLe（ZCOOL KuaiLe 400），用于登录插画大标题与全屏升级/毕业标题。英文使用前者，中文缺字回退到后者；中文页面将该标题字重设为 400。

**Body Font:** 实际 body 为 PingFang SC → Microsoft YaHei → system-ui → sans-serif。Tailwind 另定义了以 Noto Sans SC 开头的 sans 栈，但没有在已采样的功能界面启用 font-sans，也没有据此宣称加载了 Noto Sans SC。

**Character:** 功能字体清晰克制；展示字体给入口一句话以亲和力。没有独立等宽字体；积分与成长计数使用 tabular-nums。

### Hierarchy
- **Display**：display-en / display-zh 用于登录插画；celebration-headline 用于全屏升级/毕业，沿用英文 800、中文 400 权重。
- **Headline**：headline 用于工作台标题，大屏切换 headline-desktop；登录表单标题使用 headline-auth，仍为功能字体。
- **Title**：title 用于弹窗与次级标题；弹窗标题另有紧字距。
- **Body**：body 用于普通正文；学生姓名和积分同字号、字重 700。辅助段落按组件使用 1.625 行高。
- **Body small / Label**：输入、说明和按钮以小号正文为基础；字段标签字重 500，按钮字重 600。
- **Caption**：宠物名、成长说明及表格辅助文字。等级标签是局部的 11px/700，积分单位是局部的 10px/500，不扩展成新的正文层级。

### Named Rules
**The Functional Voice Rule.** 展示字体只服务登录插画大标题与全屏升级/毕业标题；常规工作台、表单、导航、数值与普通弹窗继续使用功能字体。

## Layout

基于 4px 节奏组合间距；常用内边距与卡片内容为 16px，网格间隔为 20px。工作台内容与顶栏最大宽度为 1600px，左右留白默认 20px，大屏为 36px。顶栏置顶且可换行，内容从默认 28px、大屏 36px 顶部间距开始。

学生网格使用 auto-fill 与最小 178px 等宽列，不锁定桌面列数。在不超过 480px 的视口中固定为两列，间隔 12px。每卡图片区宽高比为 1.12，图片 object-contain，不裁去宠物身体；信息区内边距为 16px。不要从截图中恰好出现的六张卡推导固定六列系统。

实际启用 Tailwind sm（640px）、md（768px）、lg（1024px）、xl（1280px）响应规则：小屏班级选择移至顶栏第二行，工具收进“班级工具”，批量入口保留；较大屏恢复完整工具文字与辅助信息。手机仍支持搜索与排序，不把工具删掉。

登录采用最大 1280px 的容器；lg 起为双列，间隔 96px；插画区在 lg 以下隐藏，表单最大宽度为 384px。插画大容器的 40px 圆角及内部 32px 圆角、轻微旋转仅属于该入口构图，不扩散到操作容器。

弹窗宽度为视口减 32px、最大 512px，wide 为 896px；最大高度 90dvh，内容内部滚动。内边距默认 20px，sm 起为 28px。表格包裹在横向滚动容器中。全屏庆祝独立占满视口并可滚动，舞台内边距为 64px 24px 44px，宠物圆章宽为 clamp(220px, 28vw, 330px)。

## Elevation & Depth

细边框与浅色分层是基础，柔和阴影辅助辨认容器和浮层。不是纯平面系统：卡片静态低阴影、悬停抬升，弹窗和批量操作栏使用更明显的柔影；登录插画中的旋转宠物卡片也原生使用柔影。

### Shadow Vocabulary
- **卡片低影**（`0 3px 12px -5px rgb(44 29 83 / .13)`）：静态学生卡片。
- **卡片悬停**（`0 8px 20px -10px rgb(67 41 122 / .2)`）：同时将边框变为 `#c9baff`，不改变布局。
- **选中标签小影**：Tailwind shadow-sm；分类标签选中时白底加轻影。
- **浮动层柔影**：Tailwind shadow-lg；通知、手机工具菜单、批量栏及登录插画卡。
- **弹窗高影**：Tailwind shadow-2xl；背景遮罩为 `#1d1538` 的 40% 不透明度，遮罩与内容同属 z-50 层。

全屏庆祝使用深蓝灰遮罩（`rgb(27 31 49 / .91)`）与金色放射光，位于 z-110/111；标题原生使用金色文字阴影，不是工作台的硬偏移盒影。Select Portal 位于 z-80，使用浮层柔影。精确展开值和层级见 sidecar。键盘焦点不靠阴影暗示：统一 2px 紫色轮廓，外移 3px；输入框有自己的浅紫 2px 轮廓、外移 1px 与紫色边框。

### Named Rules
**The Soft Layer Rule.** 表面用细线和柔影分层；悬停不位移内容，弹窗依靠遮罩与高影明确前后关系。

## Shapes

圆角依职责递进：复选框 6px，分类标签 8px，按钮与字段 12px，卡片和浮动工具 16px，弹窗和主要空状态 24px；等级、徽章与成长轨道为胶囊形。普通容器使用 1px 描边；空状态使用虚线，不能据此把虚线推广为所有卡片的边框。卡片裁切图片背景与内容，宠物本身保持完整。

## Components

### Buttons
温和而明确的操作控件。共享最小高度 40px、8px 图文间隔与颜色过渡。primary、secondary、ghost、danger 是现有四个变体；默认是 secondary。次按钮为白底浅线，悬停同时改变底色与边线；ghost 默认无可见边框。禁用或 busy 时禁用点击并降至 50% 不透明度，busy 加 Lucide 加载图标。紧凑工具栏和图标按钮存在明确的局部尺寸覆盖，不将 40px 宣称为每个按钮的绝对高度。

### Chips
等级为白底浅紫边线、深紫文字的胶囊；徽章为琥珀底、深琥珀文字及 Award 图标。卡片内两者统一为 28px 高、11px/700 字号，距图片区底部 12px；徽章图标为 13px。徽章收藏入口在透明的至少 44px 高点击区域内展示小胶囊，保留悬停、键盘焦点和弹窗交互；等级仍为非交互标记。分类导航为浅紫轨道中的标签，选中为白底紫字加小影；正负筛选复用紧凑次按钮及紫色选中状态。

### Cards / Containers
学生卡片使用白底、细线、16px 圆角与低影；悬停按 Elevation 规则强化边框与柔影。批量选中时使用紫边及 2px 浅紫 ring。整卡内容触发评价或领养，辅助按钮不与其嵌套。装扮图标与“更多”入口位于既有宠物说明行，避开积分和场景，不增加操作栏或卡片高度；桌面悬停或 `focus-visible` 键盘聚焦时显现，鼠标关闭弹窗后的返回焦点不使图标常驻，触屏常显。装扮与“更多”图标使用共享 Radix Tooltip（300ms 延迟、底部浮层、支持 Escape），不使用原生 title 提示；装扮点击直接进入弹窗；“更多”仅展开换宠与编辑，支持 Escape 和外部点击关闭。

### Pet Backgrounds
装扮只在既有弹窗增加使用资格，不增高学生卡片。「可用背景」合并默认、永久拥有、今日免费和有效的当前临时装扮，保留分类与双语搜索。节日免费显示学校时区的截止时间及到期恢复目标；免费结束仍保留预览，但禁止应用并提供重新加载，不自动兑换或扣徽章。临时使用期间兑换同款后，明确提供「改为永久使用」，不能因画面相同而禁用。商店「今日免费装扮」与原价「长期解锁」分开，零徽章或商品下架不妨碍合法免费入口；从商店打开装扮预选对应背景，关闭后返回原入口。

### Inputs / Fields
商品名称、商品描述及自定义规则名称各使用一个输入框，不要求分别填写中文与英文；保留明确标签，并以当前界面语言提供示例 placeholder。新增或修改的用户文字在两种界面中显示相同原文；编辑旧商品但未改动文字时，保留已有翻译，不因修改库存或价格覆盖内容。

白底、12px 圆角、细线、小号正文；字段标签在上方并保持关联。输入框焦点为紫边与浅紫轮廓，禁用为浅灰紫底。Select 使用下述共享 Radix 组件，不显示系统原生下拉。Textarea 最小高 144px，可竖向调整。错误通知用 danger 图标与 alert 语义；不虚构当前共享 Input 中不存在的 error 变体。

### Select / Checkbox
所有下拉使用共享 Radix Select：12px 圆角、最小高 40px、10px 12px 内边距；当前选项的 16px Lucide 图标在左侧，ChevronDown 在右侧。打开时紫边，聚焦使用 select-focus 的 2px 轮廓、外移 2px；悬停边线为 `#b8a6e3`。白色菜单至少与触发器同宽，间距 6px，碰撞留白 10px，细线、12px 圆角、柔影；过高可滚动并有上下指示。选项为 8px 圆角、最小高 40px，柔和紫色高亮；选中为 600 字重并出现 Check。保留 Radix 键盘行为，不退回可见原生 select。

Checkbox 为 Radix 组件，20px 正方形、6px 圆角；未选白底 `#b9b0cd` 边框，选中紫底白色 Check；焦点为 `#b9a5ff` 的 2px 轮廓、外移 2px，禁用为 50% 不透明度。不是原生 checkbox 的 accent-color 规则。

### Navigation
工作台以白色粘性顶栏承载品牌、班级与账号操作；工具是带 Lucide 图标的次按钮，手机收纳为下拉菜单。弹窗分类标签横向可滚动，避免压缩中文和英文标签。语言切换保留文字；图标按钮有当前语言的可访问名称。

### Dialogs
普通业务弹窗复用 Radix Dialog，带关联标题、描述、关闭名称、焦点管理及键盘行为，不另造绝对定位伪弹窗。标题、关闭按钮与内容之间保留已实现的间距；内容过高时在视口范围内滚动。标题可带 22px 紫色 Lucide 图标、间隔 10px。FullScreenDialog 同样基于 Radix，使用关联的隐藏标题与描述，保留焦点和关闭语义。

### Pet Growth
宠物图片、等级胶囊、积分与成长值共同构成卡片身份。成长轨道高 6px，填充为主紫；数值两端对齐并用 tabular-nums。填充宽度以 600ms、`cubic-bezier(.16,1,.3,1)` 更新，升级时衔接全屏庆祝。卡片边线和阴影过渡为 180ms，弹窗淡入为 120ms ease-out；常规颜色过渡沿用 Tailwind 的 150ms。prefers-reduced-motion 下动画与过渡均缩短为 .01ms、只迭代一次，滚动恢复 auto；另按组件关闭粒子和宠物动作。

### Score Feedback
普通加减分只作用于本次评价的学生宠物，不带动其他卡片；批量评价同时触发受影响学生，升级庆祝则逐位播放。加分轻跳（720ms，最大上移 12px、缩放 1.06），减分轻摇（460ms，最大水平 5px、旋转 2deg），均用 cubic-bezier(.16,1,.3,1)。中心半透明白色胶囊显示带正负号分值（27px、800）；飘分 1600ms，粒子 1300ms、依次延迟 45ms。正向九个 Heart / Star / Sparkles，负向四个 Cloud。reduced-motion 跳过 Web Animations、隐藏粒子，仍保留静态分值。

### Level-up / Graduation Celebration
用户确认的事件型例外：深色全屏遮罩、金色放射光、星形/纸屑粒子、圆形宠物相框与橙色等级圆章。旧图缩小淡出，新图在加载完成和揭示阶段后放大淡入；揭示等待 420ms，透明度过渡 650ms、形变 800ms。放射光 50s 线性旋转，70 个 Canvas 粒子最多重绘十秒。批量按事件逐位显示及标明当前位置；8 级使用独立毕业标题和徽章说明。

点击屏幕或继续按钮前进；内容容器上的 Enter / Space 也可前进；Esc 或关闭按钮结束全部庆祝。继续按钮仅在此层使用金底深棕字，最小高 46px，不把工作台主按钮改为金色。reduced-motion 不运行粒子、旋转或宠物形变，直接显示新形态，保留姓名、等级、毕业说明及继续/关闭操作。

### Pet Catalog
图鉴与领养共用数据和过滤。保留现有宠物分组，并接入鼠、牛、蛇各八张原生生成图：精灵系 2、山海系 6、动画系 1、萌宠系 41，共 50 种。生肖专题现已覆盖完整 12 属相。山海主题为九尾狐、貔貅、狻猊、青龙、白虎、朱雀，不把主题分类称为古籍出处索引。

主题标签配 Lucide 图标、名称和计数，动物类型用共享 Select；卡片默认三列，sm 五列、lg 六列，最大高 48dvh、内部滚动。每种阶段预览仍使用八张独立图像。鼠、牛、蛇的 24 张阶段图已生成、注册并开放领养，禁止以单图复用或异风格占位代替。此前临时单图 14 种已撤下，不记作发布资产。

### Imagery & Icons
操作、弹窗、分类和选项统一使用 Lucide SVG；动作保留可访问文字，装饰图标 aria-hidden。常用 15–20px，品牌及空状态可放大；不用字符模拟图标。原有可用宠物为第三方来源的原始 WebP：47 种、8 阶段、共 376 张，未生成或重绘。sidecar 保留来源、逐图清单与校验记录路径；下载与记录不等于获准再分发。

## Do's and Don'ts

### Do:
- **Do** 复用紫色操作、白色表面与语义状态色，按 Semantic Accent Rule 保留含义。
- **Do** 为中英文共用可换行布局、关联字段标签、键盘焦点与可访问名称。
- **Do** 使用 Lucide SVG、完整展示宠物图片，并保留第三方素材来源与授权提示。
- **Do** 复用 Radix Select / Checkbox / Dialog、Lucide 与功能字体，保留静态可读的 reduced-motion 反馈。
- **Do** 区分批量同时飘分与升级逐位庆祝，保留继续、Esc 和关闭全部操作。

### Don't:
- **Don't** 将登录/庆祝展示字体和插画构图推广到工作台表单或导航。
- **Don't** 将绿、红或徽章琥珀替换为无语义的装饰性操作主色。
- **Don't** 把截图中的六列、局部 11px 标签或局部圆角提升为所有页面的通用规则。
- **Don't** 用字符图标、裁切宠物或移除焦点轮廓来替换现有组件。
- **Don't** 将缺少八张独立阶段图的宠物以单图或异风格占位开放领养；新增资源落盘后必须同时注册目录并验证前后端可用。


### Student archive

桌面工具栏与手机班级工具入口统一为「归档 / Archive」。学生编辑窗口点击「归档学生」后展开原因选择和说明，均可选填；原因包括转学、毕业、休学、其他，说明最多 500 字。沿用共享 Field、Radix Select 和 Textarea，保留确认、取消、忙碌禁用和失败提示。档案详情展示原因及保留换行的说明，旧记录显示「未填写 / Not provided」。本地中英文桌面及手机浏览器流程已验证，用户验收与发布状态另行记录。
