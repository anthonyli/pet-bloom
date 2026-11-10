# 宠物图片来源

本项目代码采用 Apache-2.0，但此许可不补授第三方图片的权利。中英文使用范围、AI 素材与署名说明见 [ASSETS.md](../../ASSETS.md)。

The code license does not grant missing rights to third-party artwork. See [ASSETS.md](../../ASSETS.md) for bilingual licensing scope, AI provenance and reuse notes.

原有宠物图片为第三方导入素材，新增生肖素材的生成记录见下文。

47 种宠物共 376 张原始 WebP，未生成或重绘。每只宠物的 8 张阶段图都通过内容哈希去重检查。每张图片的本地路径和 SHA-256 见 image-manifest.csv，逐张解码结果见 verification-report.json。下载不代表获得再分发或商用授权，公开部署前请确认授权。

原有宠物分类：精灵系 2、山海系 6、动画系 1、萌宠系 38；另将既有的虎、兔、龙、马、羊、猴、鸡、狗、猪归入生肖专题。山海系是神话主题分类，不应解释为古籍出处索引。

## 未领养宠物蛋

`egg.webp` 为第三方导入的未领养学生占位图。原始 500×500 WebP，未生成或重绘，不计入可领养宠物及八阶段图数量。SHA-256：`45cd3123b25901a97cb0680a18c721c03e94f1631fd8fdd20a6cd4664ba4ca45`。使用与再分发授权仍须部署者确认。

## 原生 AI 生成的生肖素材（2026-10-31）

已新增子鼠（zodiac-rat）、丑牛（zodiac-ox）、巳蛇（zodiac-snake），每种 8 张独立阶段图，共 24 张，文件为各目录下 lv1.webp 至 lv8.webp，均为无损 WebP。通过 Codex 原生 image_gen 生成八格成长分镜后逐格裁切，未复用单图伪装等级；560×560 白底 PNG 生成稿保留，当前发布的 24 张原路径 WebP 已统一处理为透明底，并裁去多余透明外边距，使显示占比与现有宠物一致。所有可见主体像素完整保留，RGB 与 PNG 生成稿保持一致，无缩放或拉伸。24 张均可解码、SHA-256 各不相同。素材已注册到 lib/data/pets.json 并开放领养，当前共 50 种宠物、400 张阶段图，十二生肖专题已补齐 12 个属相。

不同画风的临时单图素材已撤下，不进入发布资源。本批参考本项目 westie、pig、chick 的 Lv.1、Lv.4、Lv.8；实际生成参考输入及完整提示词、生成时间、尺寸、SHA-256 和导出信息见 zodiac-generation-manifest.json。原生工具未提供模型选择参数，也未披露实际模型，故不标称 gpt-image-2。PNG 原稿与分镜保留在 .impeccable/generated/codex-zodiac-20261031-native-a7c9/。

## 原创宠物背景 SVG 场景

背景目录 `lib/data/backgrounds.json` 包含 41 项本项目原创矢量场景：4 种日常场景、22 种国内节日、15 种国际与海外节日，以 `category` 字段分组。对应本地 SVG 的路径位于相对本说明的 `../pet-backgrounds/` 目录，目录与名称如下。

| 文件 | 分类 | 场景 |
| --- | --- | --- |
| `../pet-backgrounds/garden.svg` | 日常场景 | 花园午后 · Garden afternoon |
| `../pet-backgrounds/starlight.svg` | 日常场景 | 星光营地 · Starlight camp |
| `../pet-backgrounds/beach.svg` | 日常场景 | 海边假日 · Seaside holiday |
| `../pet-backgrounds/classroom.svg` | 日常场景 | 阳光教室 · Sunny classroom |
| `../pet-backgrounds/spring-festival.svg` | 国内节日 | 春节 · 灯笼小院 / Spring Festival · Lantern courtyard |
| `../pet-backgrounds/lantern-festival.svg` | 国内节日 | 元宵 · 花灯长街 / Lantern Festival · Lantern lane |
| `../pet-backgrounds/qingming.svg` | 国内节日 | 清明 · 柳岸春雨 / Qingming · Willow rain |
| `../pet-backgrounds/dragon-boat.svg` | 国内节日 | 端午 · 龙舟水岸 / Dragon Boat Festival · Riverside race |
| `../pet-backgrounds/qixi.svg` | 国内节日 | 七夕 · 银河鹊桥 / Qixi · Milky Way bridge |
| `../pet-backgrounds/ghost-festival.svg` | 国内节日 | 中元 · 河灯寄愿 / Zhongyuan · River lantern wishes |
| `../pet-backgrounds/mid-autumn.svg` | 国内节日 | 中秋 · 桂影月圆 / Mid-Autumn · Moonlit osmanthus |
| `../pet-backgrounds/double-ninth.svg` | 国内节日 | 重阳 · 菊香登高 / Double Ninth · Chrysanthemum hills |
| `../pet-backgrounds/laba.svg` | 国内节日 | 腊八 · 冬日暖粥 / Laba · Winter porridge |
| `../pet-backgrounds/national-day.svg` | 国内节日 | 国庆 · 花坛庆典 / National Day · Festive city garden |
| `../pet-backgrounds/labour-day.svg` | 国内节日 | 劳动节 · 耕耘花圃 / Labour Day · Growing garden |
| `../pet-backgrounds/childrens-day.svg` | 国内节日 | 儿童节 · 风筝乐园 / Children’s Day · Kite park |
| `../pet-backgrounds/teachers-day.svg` | 国内节日 | 教师节 · 花香书桌 / Teachers’ Day · Flowers and books |
| `../pet-backgrounds/lunar-new-years-eve.svg` | 国内节日 | 除夕 · 团圆守岁 / Lunar New Year’s Eve · Reunion night |
| `../pet-backgrounds/little-new-year.svg` | 国内节日 | 小年 · 糖香迎春 / Little New Year · Sweet preparations |
| `../pet-backgrounds/dragon-head-raising.svg` | 国内节日 | 龙抬头 · 祥龙迎春 / Dragon Head-raising Day · Spring dragon |
| `../pet-backgrounds/winter-solstice.svg` | 国内节日 | 冬至 · 暖冬团圆 / Winter Solstice · Winter reunion |
| `../pet-backgrounds/arbor-day.svg` | 国内节日 | 植树节 · 春苗新生 / Arbor Day · Growing saplings |
| `../pet-backgrounds/youth-day.svg` | 国内节日 | 青年节 · 青春向阳 / Youth Day · Towards the sun |
| `../pet-backgrounds/cpc-founding-day.svg` | 国内节日 | 建党节 · 七一晨光 / CPC Founding Day · July morning |
| `../pet-backgrounds/army-day.svg` | 国内节日 | 建军节 · 八一和平 / Army Day · Wings of peace |
| `../pet-backgrounds/farmers-harvest-festival.svg` | 国内节日 | 中国农民丰收节 · 金秋满仓 / Chinese Farmers’ Harvest Festival · Golden granary |
| `../pet-backgrounds/new-year.svg` | 国际与海外 | 元旦 · 新年钟声 / New Year · Midnight chimes |
| `../pet-backgrounds/valentines-day.svg` | 国际与海外 | 情人节 · 玫瑰花园 / Valentine’s Day · Rose garden |
| `../pet-backgrounds/womens-day.svg` | 国际与海外 | 妇女节 · 春日花园 / Women’s Day · Spring blossoms |
| `../pet-backgrounds/earth-day.svg` | 国际与海外 | 地球日 · 森林星球 / Earth Day · Woodland planet |
| `../pet-backgrounds/book-day.svg` | 国际与海外 | 读书日 · 书香天地 / Book Day · Storybook hideaway |
| `../pet-backgrounds/mothers-day.svg` | 国际与海外 | 母亲节 · 康乃馨花房 / Mother’s Day · Carnation greenhouse |
| `../pet-backgrounds/fathers-day.svg` | 国际与海外 | 父亲节 · 林间野餐 / Father’s Day · Woodland picnic |
| `../pet-backgrounds/easter.svg` | 国际与海外 | 复活节 · 彩蛋春野 / Easter · Spring egg meadow |
| `../pet-backgrounds/halloween.svg` | 国际与海外 | 万圣节 · 南瓜月夜 / Halloween · Pumpkin moonlight |
| `../pet-backgrounds/thanksgiving.svg` | 国际与海外 | 感恩节 · 秋收庭院 / Thanksgiving · Harvest courtyard |
| `../pet-backgrounds/christmas.svg` | 国际与海外 | 圣诞节 · 雪夜小屋 / Christmas · Snowy cottage |
| `../pet-backgrounds/st-patricks-day.svg` | 国际与海外 | 圣帕特里克节 · 三叶草溪谷 / St Patrick’s Day · Shamrock valley |
| `../pet-backgrounds/diwali.svg` | 国际与海外 | 排灯节 · 点灯庭院 / Diwali · Courtyard of lights |
| `../pet-backgrounds/eid-al-fitr.svg` | 国际与海外 | 开斋节 · 月夜灯廊 / Eid al-Fitr · Moonlit lantern arcade |
| `../pet-backgrounds/hanukkah.svg` | 国际与海外 | 光明节 · 冬窗烛光 / Hanukkah · Winter window lights |

这些背景不来自第三方站点，仅作为宠物卡片的背景场景，不替换、重绘或修改原有宠物图片，也不计入宠物八阶段成长图数量。2026-11-01 按节日代表元素强化既有 28 种节日场景，并新增上述 9 种国内节日；国庆使用大红庆典与按 30×20 网格绘制的五星红旗，建军节采用「八一」矢量笔画、红旗和和平鸽，不包含武器或军徽。新增及修改部分仍为本项目原创本地 SVG，无外部资源或字体依赖。

## 生肖原图透明底处理（2026-11-01）

鼠、牛、蛇的 24 张 `lv1.webp` 至 `lv8.webp` 统一在原路径使用透明底，供默认卡片、图鉴、领养与背景装扮共用；不再保留 `../pet-backgrounds/pets/` 背景专用副本或其独立派生清单。这些图片复用已核验的透明处理结果，不是重新调用模型生成的宠物图；白底 PNG 生成稿与分镜继续保留在 `.impeccable/generated/codex-zodiac-20261031-native-a7c9/`。

处理方法保留原始 RGB，从图片四边按四邻域连通查找并移除中性近白背景（RGB 最小通道值 ≥225、最大与最小通道差 ≤25）。在本机用 Apple Vision 的 `VNGenerateForegroundInstanceMaskRequest` 计算主体 alpha，仅对主体底部向上 20% 图高的接地区域精修透明度，并将该蒙版中低于 8/255 的 alpha 置零，去除底片和孤立背景残留；牛 Lv.4 的前景花草保留原始轮廓。随后仅裁去完全透明的外边距，四周保留 4px 透明安全边，全部 alpha 大于零的像素及其透明度保持不变；不缩放、不拉伸，不靠 CSS 对个别宠物加倍率。最后以无损 WebP 编码。未上传任何图像，未重绘主体，也不是将整张图中所有白色像素统一透明化。

`zodiac-generation-manifest.json` 保留原生生成与白底 PNG 的历史记录；其中 `webp_export` 记录当前发布图的透明处理方法、PNG 来源路径与哈希（`source`、`source_sha256`）、处理前 WebP 哈希（`original_webp_sha256`）、当前文件哈希（`sha256`）、字节数及透明像素数量（`transparent_pixels`）。每图还记录原画布尺寸与透明像素数（`uncropped_dimensions`、`uncropped_transparent_pixels`）、相对于 PNG 原稿的裁切框（`crop`）和发布尺寸（`dimensions`），用于验证没有丢失主体像素。每张发布图的 WebP 原生 XMP 中也嵌入 PNG 来源、处理前哈希、裁切框及处理方法，不新增逐图 JSON 旁文件，也不代表新增外部授权。
