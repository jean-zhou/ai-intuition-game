# ai-intuition-game

第一直觉 · 快问快答 —— 快速潜意识选择训练小游戏

## 运行

```bash
npm install   # 已装好，重新拉代码后执行
npm start     # 默认 3000 端口，可用 PORT=xxxx 指定
```

打开 http://localhost:3000 即可玩。

## 结构

- `server.js` —— 服务端：静态页面托管、代理 Qwen API（出题 `/api/question` + 直觉画像 `/api/analyze`）、AI 失败时本地词库兜底
- `public/index.html` —— 前端全部代码（CSS/JS 内嵌）：文案页、题目类型切换（生活/抽象）、倒计时选择、30 题结算、localStorage 记录、直觉画像展示
- `local-bank.js` —— 本地兜底词库（生活题 45 对 / 抽象题 80 对）
- `.env` —— `DASHSCOPE_API_KEY`（Qwen 的 Key）和 `QWEN_MODEL`（默认 qwen-plus）

## 常用调试入口

| 改什么 | 位置 |
|---|---|
| 每局题数 | `public/index.html` → `ROUNDS_PER_GAME` |
| 倒计时（生活/抽象） | `public/index.html` → `ROUND_MS_LIFE` / `ROUND_MS_ABSTRACT` |
| 首页/结算页文案 | `public/index.html` → `.copy` / `.doneSub` |
| 画像解读风格 | `server.js` → `ANALYZE_SYSTEM` |
| 出题 prompt 与类别池 | `server.js` → `MODE_PROMPTS` / `CATEGORIES` / `LIFE_CATEGORIES` |
| 本地兜底题库 | `local-bank.js` |

## 注意

- `.env` 已加入 `.gitignore`，**不要把 API Key 提交到 git**
- 线上分享链接跑的是 WorkBuddy 发布的快照，本地改动不影响线上；要更新线上需重新发布
