// 第一直觉 · 快问快答 - 服务端
// 职责：1) 提供静态页面  2) 代理 Qwen API（规避浏览器 CORS，Key 只留在服务端）
//      3) AI 失败/超时时返回本地词库兜底，保证游戏节奏永不断

const express = require('express');
const path = require('path');
const fs = require('fs');
const bank = require('./local-bank');

// 简易 .env 加载（本地/沙盒环境用；线上环境变量优先）
(function loadEnv() {
  try {
    const content = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch (e) { /* .env 不存在则忽略 */ }
})();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-turbo';
const API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

// 类别池：每次随机选一个，让 AI 的出题方向多样化
const CATEGORIES = [
  '美食诱惑', '旅行想象', '生活方式', '感官体验', '童年回忆',
  '自然奇观', '脑洞超能力', '小冒险', '日常小确幸', '二难抉择',
  '声音与气味', '天气与季节', '动物伙伴', '未来畅想'
];

// 生活题专用类别池：全部围绕日常真实的小决定
const LIFE_CATEGORIES = [
  '今天吃什么', '喝什么', '周末怎么过', '晚上怎么放松',
  '出行方式', '购物小决定', '假期去哪', '运动方式',
  '和朋友聚会', '日常习惯', '零食选择', '追剧看片'
];

// 服务端也缓存最近出过的题（内存级，退出即弃），供去重使用
const recentQuestions = [];
const MAX_RECENT = 30;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const MODE_PROMPTS = {
  // 生活题：接地气的日常简单选择
  life: `你是一个"第一直觉训练游戏"的出题器。生成一对"生活中的简单日常选择"。
要求：
1. 必须是接地气、马上能做决定的日常小事，比如"今天吃麻辣烫还是重庆小面"、"周末爬山还是宅家"；
2. 范围：吃什么、喝什么、去哪玩、怎么过周末、日常小决定，轻松有趣，不烧脑；
3. 每个选项 2~10 个字，具体不空泛；
4. 不涉及政治、暴力、敏感话题，不涉及真实人名；
5. 严格输出 JSON：{"left":"选项一","right":"选项二"}`,
  // 抽象题：意境与脑洞
  abstract: `你是一个"第一直觉训练游戏"的出题器。生成一对适合快速二选一的选项。
要求：
1. 每个选项是 2~10 个字的具体名词短语，画面感强、有意境或脑洞；
2. 两个选项要有趣、有张力、大致平等，让人纠结但想马上选；
3. 内容轻松正向，不涉及政治、暴力、敏感话题，不涉及真实人名；
4. 严格输出 JSON：{"left":"选项一","right":"选项二"}`
};

function pickLocalQuestion(mode) {
  if (mode === 'life') {
    const p = pickRandom(bank.lifePairs);
    return { left: p[0], right: p[1], category: '生活词库', source: 'local' };
  }
  const all = bank.pairs.concat(bank.extra);
  const p = pickRandom(all);
  return { left: p[0], right: p[1], category: '抽象词库', source: 'local' };
}

function buildPrompt(mode) {
  const category = pickRandom(mode === 'life' ? LIFE_CATEGORIES : CATEGORIES);
  const avoid = recentQuestions.slice(-10).join('；');
  const user = `类别：${category}${avoid ? `\n避免与这些重复或雷同：${avoid}` : ''}`;
  return { system: MODE_PROMPTS[mode] || MODE_PROMPTS.abstract, user, category };
}

async function generateByAI(mode) {
  const { system, user, category } = buildPrompt(mode);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000); // 6 秒超时，超时即兜底
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        response_format: { type: 'json_object' },
        temperature: 1.1
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    const left = String(parsed.left || '').trim();
    const right = String(parsed.right || '').trim();
    if (!left || !right || left === right) throw new Error('bad content');
    return { left, right, category, source: 'ai' };
  } finally {
    clearTimeout(timeout);
  }
}

app.post('/api/question', async (req, res) => {
  const mode = (req.body && req.body.mode === 'abstract') ? 'abstract' : 'life';
  if (!DASHSCOPE_API_KEY) {
    return res.json(pickLocalQuestion(mode));
  }
  try {
    const q = await generateByAI(mode);
    recentQuestions.push(`${q.left} / ${q.right}`);
    if (recentQuestions.length > MAX_RECENT) recentQuestions.shift();
    res.json(q);
  } catch (err) {
    console.error('[fallback] AI 生成失败，使用本地词库:', err.message);
    res.json(pickLocalQuestion(mode));
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ai: !!DASHSCOPE_API_KEY, model: QWEN_MODEL });
});

// ---------- 直觉画像：原始记录交给 AI 分析 ----------
const ANALYZE_SYSTEM = `你是"第一直觉训练游戏"的数据解读者。用户给你一组客观的选择记录（题目、类别、选择、反应时毫秒数、是否超时、档位、轮次、时间戳）。
请输出一份"直觉画像"，严格遵守：
1. 全程第二人称"你"，轻松友好、略带俏皮的语气；
2. 输出以下 5 个板块，每个板块 2~3 句话：
📊 数据概览 —— 一句话总结总共玩了多少题、整体状态；
⏱ 速度画像 —— 由你根据反应时数据判断他的快慢（比如平均反应时、最快最慢的悬殊、是否越玩越快），不用固定标准，给出你自己的解读；
🧭 选择倾向 —— 左右位置偏好、类别偏好（从记录里客观统计后用一句话点出来）；
💭 犹豫时刻 —— 超时和长反应时说明什么，温和地解读；
🎲 给你的一条小建议 —— playful，与他的数据相关；
3. 不要逐题罗列，不下对错评判，不用诊断式心理学标签，不编造数据里不存在的信息；
4. 直接输出纯文本（用板块标题+换行），不要输出 JSON 或 markdown 代码块。`;

function localSummary(records) {
  const n = records.length;
  const left = records.filter(r => r.choice === 'L').length;
  const timeouts = records.filter(r => r.timeout).length;
  const times = records.filter(r => !r.timeout && r.reactionMs > 0).map(r => r.reactionMs);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  return `📊 数据概览\n你一共完成了 ${n} 道选择（本次分析为离线统计，AI 画像暂不可用）。\n\n⏱ 速度画像\n平均反应时 ${avg} 毫秒，最快 ${times.length ? Math.min(...times) : '-'} 毫秒，最慢 ${times.length ? Math.max(...times) : '-'} 毫秒。\n\n🧭 选择倾向\n左边 ${left} 次，右边 ${n - left} 次。\n\n💭 犹豫时刻\n超时 ${timeouts} 次，超时也是你的直觉在说"再想想"。\n\n🎲 一条小建议\n下一次玩，试着在选项出现的第一眼就出手——看看会发生什么。`;
}

app.post('/api/analyze', async (req, res) => {
  const records = Array.isArray(req.body && req.body.records) ? req.body.records.slice(-200) : [];
  if (!records.length) {
    return res.json({ text: '还没有任何记录——先去玩一局，让直觉留下点痕迹吧。' });
  }
  if (!DASHSCOPE_API_KEY) {
    return res.json({ text: localSummary(records) });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages: [
          { role: 'system', content: ANALYZE_SYSTEM },
          { role: 'user', content: '这是我的选择记录，请生成直觉画像：\n' + JSON.stringify(records) }
        ],
        temperature: 0.9
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('empty');
    res.json({ text: text.trim() });
  } catch (err) {
    console.error('[analyze] AI 分析失败，使用本地统计:', err.message);
    res.json({ text: localSummary(records) });
  }
});

app.listen(PORT, () => {
  console.log(`第一直觉快问快答已启动: http://localhost:${PORT}`);
  console.log(`AI 出题: ${DASHSCOPE_API_KEY ? '已开启 (' + QWEN_MODEL + ')' : '未配置 Key，使用本地词库'}`);
});
