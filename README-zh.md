# Agent Token Cost Dashboard

这是一个**轻量级**、**零第三方依赖**且**高度可扩展**的 Agent 框架 Token 用量及成本统计看板。通过极简的架构，实时监控不同 Agent 框架所产生的 Token 消耗与精细化资金成本。目前已原生内置支持 **Claude Code** 与 **Codex**。
原理是读取Agent框架保存在本地的持久化Session文件，提取Token相关的信息，因此只支持持久化 Session 信息在本地的框架以及返回的元数据里有Token相关信息的模型提供商。绝大多数框架和提供商都满足这两个条件，
但仍需注意少数框架或提供商可能不支持。

---
## 图片展示
<img width="2426" height="1387" alt="QQ20260610-014119" src="https://github.com/user-attachments/assets/46813e06-d2ea-4e10-9d74-5785718ea63c" />
<img width="1904" height="895" alt="QQ20260610-014522" src="https://github.com/user-attachments/assets/0bcaf51b-2a80-4300-8fff-d10266769a61" />
<img width="1941" height="1000" alt="QQ20260610-014745" src="https://github.com/user-attachments/assets/66b2ee84-d11f-44bc-aa97-30b6f2609aff" />
<img width="1908" height="1201" alt="QQ20260610-015059" src="https://github.com/user-attachments/assets/edb81e4e-403d-4f2e-972c-3251a6c839f8" />

---
## 核心优势

1. **零依赖与轻量化 (Lightweight)**：
   - 后端仅采用 Python 原生 `http.server` 与 `socketserver.ThreadingTCPServer`，无需安装任何 pip 第三方库，一键秒开。
   - 前端采用原生 HTML5, Vanilla JS, CSS3 构建，无打包编译步骤，体积小巧，极速加载。
2. **高度可扩展 (Extensible)**：
   - **Agent 框架扩展**：插件化设计。只需在 `parsers/` 目录下放置一个新的 Python 解析脚本，后端便能自动识别并加载该框架。可以让AI参考现存脚本的逻辑生成。
   - **多语言扩展 (i18n)**：无需修改任何代码，在 `public/lang/` 下放入一个自定义的 `<语言文件名>.json`，右上角的 `Language` 下拉菜单便会自动装载该翻译文件。
   - **便捷修改Token单价**：可以根据实际情况在config文件或者网页修改token价格，还支持设置倍率。
3. **安全与准确**：
   - 精细防噪过滤，通过严格识别消息角色（如 Claude 仅统计 `assistant` 消息）与计算增量 (Delta)，完全杜绝因用户输入包含 Token 信息或日志文件重复读取导致的误差。
4. **实时更新**：
   - 服务运行时会实时解析最新对话获取最新token消耗，但需要手动刷新页面（不设计成自动刷新是为了减少不必要的开销）。
---

## 统计指标与多维度展示

看板针对不同类别，分别展示并计算了以下核心指标：

### 核心统计指标
* **输入 Token (Input)**：发送给模型的提示词 Token 数量。
* **输出 Token (Output)**：模型生成的回复 Token 数量。
* **缓存读取 (Cache Read)**：命中缓存直接读取的 Token 数量。
* **缓存写入 (Cache Create/Write)**：创建或更新缓存时消耗的 Token 数量。
* **缓存命中率 (Cache Hit Rate)**：计算公式为 $\frac{\text{缓存读取}}{\text{输入} + \text{缓存读取}} \times 100\%$，用于评估缓存利用效率。
* **预估金额/总成本 (Cost)**：基于每款模型设定的百万 Token 单价（输入、输出、缓存读、缓存写）与单模独立的倍率因子（Multiplier）计算而得。

### 展示维度
* **全局统计 (Global Stats)**：汇总所有会话的 Token 类型比例与各模型用量占比、预估费用。
* **框架统计 (Framework Stats)**：对比不同 Agent 框架（如 Claude Code vs Codex）的会话数、各项用量指标、平均缓存命中率与总消耗金额。
* **项目统计 (Project Stats)**：按 Agent 运行的工作目录 (CWD) 进行汇总，支持通过 `config.json` 动态排除临时或无关项目。
* **会话明细 (Session Stats)**：按时间倒序分页展示会话，悬停于 Tokens 或金额上方可查看精细到单次请求的各模型成本构成详情。

---

## 运行与配置

### 快速启动
#### Windows (一键启动)
双击根目录下的 `run.bat`，即可一键启动后端服务并保持窗口常开以供调试。
#### Linux / macOS / 命令行
```bash
python server.py
```
启动后，浏览器访问: `http://localhost:8000`

### 配置文件说明 (`config.json`)
系统配置文件会在首次运行或通过网页前端“单价与配置”卡片保存后在根目录下自动生成。
```json
{
  "exclude_paths": [
    "C:\\Users\\82541\\Documents\\Codex\\*",
    "E:\\Develop_Program\\QuantAgent"
  ],
  "lang": "zh-CN",
  "models": {
    "deepseek-v4-flash": {
      "input": 0.14,
      "output": 0.28,
      "cacheRead": 0.06,
      "cacheCreate": 0.14,
      "multiplier": 1.0
    }
  }
}
```
* **exclude_paths (项目排除路径)**：支持通配符的路径列表，匹配的工作目录将不会在“项目统计”中被汇总。(用于排除非项目的临时会话)
* **lang (语言设置)**：偏好的界面语言代码（如 `zh-CN`，`en-US` 等）。
* **models (模型单价与倍率)**：设置每 **百万 Token (1M Tokens)** 的价格 (USD) 以及模型特定的倍率因子。

---

## 开发扩展手册

### 1. 扩展一个新的 Agent 解析器
1. 在 `parsers/` 目录下新建一个 Python 脚本，例如 `parsers/my_agent.py`。
2. 创建一个继承自 `BaseParser`（定义在 `parsers/base.py`）的类，并重写两个方法：
```python
from pathlib import Path
from .base import BaseParser

class MyAgentParser(BaseParser):
    def get_framework_name(self) -> str:
        return "My New Agent"

    def parse_sessions(self, config_manager) -> list[dict]:
        # 扫描对应日志目录，解析所有会话，计算 cost 并返回标准格式 session 字典列表。
        pass
```
*可参考 `parsers/claude.py` 与 `parsers/codex.py` 的具体解析与 Delta 机制实现。*

### 2. 增加一种界面语言
1. 在 `public/lang/` 目录下创建一个新的 JSON 翻译文件，命名为 `<语言代码>.json`，例如 `public/lang/fr.json`。
2. 复制 `public/lang/en-US.json` 中的全部键并翻译对应的值。
3. 保存后刷新页面，右上角 **"Language"** 下拉菜单会自动加载并展示该语言选项。
