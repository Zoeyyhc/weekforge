# Google OAuth 验证指南

WeekForge 通过 Google OAuth 访问用户的 **Google Calendar**（`https://www.googleapis.com/auth/calendar`）。
该 scope 属于 Google 的 **restricted scope（受限范围）**，验证要求高于普通 sensitive scope。

本文记录两条路线：
- **方案 A（推荐用于作品集 / 演示）**：保持 Testing 模式 + 测试用户，**不走正式验证**。
- **方案 B（仅当要公开给陌生人使用）**：完成完整的 Google 验证（含受限范围的安全评估）。

---

## 背景：为什么会出现「此应用未经 Google 验证」

后端发起 OAuth 时请求了 Calendar 权限。只要 App 处于 **Testing** 且登录账号是测试用户，会看到一个警告屏：

> 此应用未经 Google 验证 …… 请勿使用该应用。

这是 Google 对未验证应用的统一拦截，**不是出错**。测试用户点「高级 → 继续」即可正常授权。

---

## 方案 A：Testing 模式 + 测试用户（推荐）

零成本、立即可用，适合 portfolio / 面试 demo。

1. Google Cloud Console → **APIs & Services → OAuth consent screen**。
2. **Publishing status** 保持在 **Testing**（不要点 “Publish App”）。
3. **Test users → Add Users** → 加入要演示的 Google 账号（如 `najumcao@gmail.com`），最多 100 个。
4. 保存。

登录时遇到警告屏，点：
**高级（Advanced）→ 继续前往 weekforge（不安全）（Go to weekforge (unsafe)）** → 正常授权。

> 「不安全」只是未验证应用的统一提示；你自己和你授权的测试用户使用是安全的。

**面试可用的工程权衡解释：**
> 这是作品集项目，故意保持在 OAuth Testing 模式 + 测试用户白名单，没有走完整的 Google 验证——因为 Calendar 是受限范围，正式验证需要隐私政策、网站所有权验证、演示视频，以及每年可能收费的 CASA 第三方安全评估，对一个没有真实公众用户的演示项目性价比极低。需要公开发布时再走验证即可。

---

## 方案 B：完整 Google 验证（仅在要公开发布时）

### 一、需要先准备的资产（必须在你拥有的域名下）

| 项目 | 是否必须 | 说明 |
|---|---|---|
| 自有域名 | 必须 | 所有 URL 都要在此域名下（Vercel 临时域名 / Notion 链接通常不被接受）。 |
| 首页 Homepage | 必须 | 公开可访问，说明 App 用途。 |
| 隐私政策 Privacy Policy | **必须** | 独立 URL，说明如何使用/存储 Google 用户数据，并明确提及 Google 用户数据。 |
| 服务条款 Terms of Service | 建议 | 有则填。 |
| App Logo | 建议 | 120×120 正方形。 |

### 二、Search Console 验证网站所有权（最大卡点）

1. 打开 **Google Search Console** → 添加你的域名为 Property。
2. 用 **DNS TXT 记录** 验证所有权（回 Namecheap → Advanced DNS 加一条 TXT）。
3. ⚠️ 验证所有权的 Google 账号 **必须同时是 GCP 项目的 Owner 或 Editor** —— 用**同一个账号**做这两件事。
4. 网站所有权验证完成前，OAuth 验证请求不会被批准。

### 三、填写 OAuth Consent Screen

Console → APIs & Services → **OAuth consent screen**：

1. App name、User support email、Developer contact email。
2. **App homepage** → 首页 URL。
3. **Privacy policy URL** → 隐私政策 URL。
4. **Authorized domains** → 加入根域名。
5. **Scopes** → 确认列出 Calendar scope，并逐个写明用途。
6. **Publishing status** 切到 **In production**。

### 四、提交验证 + 受限范围额外要求

点 **Submit / Save**，在验证表单中：

1. **逐条解释每个 scope** 的用途（Calendar：读取忙闲 + 写入排程事件）。
2. **录制演示视频（YouTube 链接）**：完整展示 OAuth 同意流程 + App 如何实际使用权限；视频中要能看到 OAuth `client_id`。
3. **CASA 安全评估（受限范围特有）**：Calendar 这类 restricted scope，Google 通常要求通过 **CASA（Cloud Application Security Assessment）Tier 2** 第三方安全评估 —— **可能收费（数百~上千美元/年），且每年重做**。

### 五、提交后

- 审核周期：**几天到几周**，可能来回补材料。
- ⚠️ 通过后任何改动（新增 redirect URI / JS origin、改 App 名称）都要**重新验证**。

---

## 决策建议

| 你的目标 | 选哪个 |
|---|---|
| 作品集 / 面试演示 / 自己用 | **方案 A**（Testing + 测试用户） |
| 真实产品，开放陌生人注册 | 方案 B（完整验证 + CASA） |

对 WeekForge 当前定位（portfolio），**采用方案 A**。

---

## 相关文档

- 部署流程见 [`deployment.md`](./deployment.md)（OAuth env 变量配置在其中）。
- 官方：Google OAuth Application Verification FAQ。
