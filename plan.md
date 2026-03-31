# hydro-restful-api 扩展计划

> 目标：为 Agent（像我这样的 LLM）提供完整的 HydroOJ 操作能力。
> 当前状态：只有读操作。目标：支持题目上传、作业/比赛/训练计划创建。

---

## 一、架构概览

```
Agent (me)
  └── REST API calls (Bearer JWT)
        └── hydro-restful-api addon (运行在 HydroOJ 进程内)
              └── HydroOJ Model API (ProblemModel, ContestModel, TrainingModel)
```

**两个组件需要同步扩展：**

| 组件 | 职责 | 技术栈 |
|---|---|---|
| `addon/routes.ts` | 新增 POST handler | TypeScript，调用 `Hydro.model.*` |
| `cli/ts/index.ts` | 新增 CLI 命令 | Node.js HTTP 客户端 |

---

## 二、API 设计

### 2.1 题目上传 — `POST /rest-api/problems`

**Request：** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 否 | 题目标题，zip 包内有时可省略 |
| `content` | string | 否 | 题目描述（markdown），zip 包内有时可省略 |
| `tags` | string | 否 | 逗号分隔的标签列表，如 `"dp,图论"` |
| `difficulty` | number | 否 | 难度 0-5 |
| `hidden` | boolean | 否 | 是否隐藏，默认 false |
| `pid` | string | 否 | 指定 pid，留空则自增 |
| `zip` | file | **是** | ICPC problem package zip 文件 |

**Response：**
```json
{
  "id": 42,
  "pid": "A-001",
  "title": "Two Sum"
}
```

**内部流程：**
1. 接收 zip 文件到临时目录
2. 调用 `ProblemModel.import(domainId, zipPath, { preferredPrefix })`
3. 返回新题目的 `docId` 和 `pid`
4. 清理临时文件

**权限：** `PERM.PERM_CREATE_PROBLEM`

---

### 2.2 比赛创建 — `POST /rest-api/contests`

**Request：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | **是** | 比赛标题 |
| `content` | string | 否 | 比赛说明（markdown） |
| `rule` | string | **是** | 赛制：`"acm"` / `"oi"` / `"ioi"` / `"ledo"` |
| `beginAt` | ISO8601 string | **是** | 开始时间，如 `"2026-04-01T10:00:00+08:00"` |
| `endAt` | ISO8601 string | **是** | 结束时间 |
| `pids` | number[] | **是** | 题目 docId 数组，需已存在 |
| `duration` | number | 否 | 相对时间（小时），允许选手从首次进入起计时参赛 |
| `rated` | boolean | 否 | 是否计入 Rating |
| `pin` | boolean | 否 | 是否置顶 |
| `assign` | string[] | 否 | 指定参赛人员用户名列表 |
| `langs` | string[] | 否 | 允许的语言列表，如 `["cpp", "java", "python"]` |
| `allowViewCode` | boolean | 否 | 是否允许赛后查看代码 |
| `allowPrint` | boolean | 否 | 是否允许打印 |
| `score` | object | 否 | 每题满分，key 为 pid，value 为分数 |
| `lockAt` | ISO8601 string | 否 | 封榜时间（ACM 赛制） |
| `balloon` | object | 否 | 气球配置，key 为 pid |

**Response：**
```json
{
  "id": "6842a1b3c9...",
  "title": "Weekly Contest 42"
}
```

**内部流程：**
```typescript
ContestModel.add(
  domainId, title, content, owner,  // owner 来自 JWT uid
  rule, new Date(beginAt), new Date(endAt), pids,
  rated, { assign, langs, duration, score, balloon, lockAt, ... }
);
```

**权限：** `PERM.PERM_CREATE_CONTEST`

---

### 2.3 作业创建 — `POST /rest-api/homework`

作业本质是 `rule = "homework"` 的 Contest。

**Request：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | **是** | 作业标题 |
| `content` | string | 否 | 作业说明 |
| `beginAt` | ISO8601 string | **是** | 开始时间 |
| `endAt` | ISO8601 string | **是** | 截止时间 |
| `pids` | number[] | **是** | 题目 docId 数组 |
| `duration` | number | 否 | 相对时间（小时），从首次进入起计时 |
| `assign` | string[] | 否 | 指定学生用户名列表 |
| `langs` | string[] | 否 | 允许的语言 |
| `penaltySince` | ISO8601 string | 否 | 迟交扣分开始时间 |
| `penaltyRules` | object | 否 | 迟交扣分规则，如 `{ "24": 0.75, "48": 0.5 }` 表示 24h 后 75% 得分，48h 后 50% 得分 |
| `score` | object | 否 | 每题满分 |

**Response：**
```json
{
  "id": "6842a1b3c9...",
  "title": "Chapter 3 Homework"
}
```

**内部流程：**
```typescript
ContestModel.add(
  domainId, title, content, owner,
  'homework', new Date(beginAt), new Date(endAt), pids,
  false, { assign, langs, duration, penaltySince, penaltyRules, score }
);
```

**权限：** `PERM.PERM_CREATE_HOMEWORK` 或 `PERM.PERM_CREATE_CONTEST`

---

### 2.4 训练计划创建 — `POST /rest-api/trainings`

**Request：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | **是** | 训练计划标题 |
| `content` | string | 否 | 训练计划说明 |
| `description` | string | 否 | 简短描述 |
| `pin` | number | 否 | 置顶权重，数字越大越靠前 |
| `dag` | TrainingNode[] | **是** | DAG 节点列表，**至少一个节点** |

**TrainingNode 结构：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | number | **是** | 节点唯一 ID（整数） |
| `title` | string | **是** | 节点标题 |
| `requireNids` | number[] | **是** | 前置节点 ID 列表（可为空） |
| `pids` | number[] | **是** | 该节点包含的题目 docId 列表 |

**DAG 验证规则（在 handler 层强制）：**
- 所有 `_id` 唯一
- 每个节点的 `requireNids` 中引用的 ID 都必须存在于 DAG 中
- 每个节点的 `pids` 至少有一个，且题目 docId 需已存在
- 不允许循环依赖（由 DAG 结构天然保证）

**Example Request：**
```json
{
  "title": "Algorithm Basics",
  "content": "A structured curriculum for beginners.",
  "pin": 0,
  "dag": [
    {
      "_id": 1,
      "title": "Getting Started",
      "requireNids": [],
      "pids": [101]
    },
    {
      "_id": 2,
      "title": "Sorting Algorithms",
      "requireNids": [1],
      "pids": [102, 103]
    },
    {
      "_id": 3,
      "title": "Binary Search",
      "requireNids": [1],
      "pids": [104, 105]
    },
    {
      "_id": 4,
      "title": "Advanced Sorting",
      "requireNids": [2, 3],
      "pids": [106]
    }
  ]
}
```

**Response：**
```json
{
  "id": 42,
  "title": "Algorithm Basics"
}
```

**内部流程：**
```typescript
TrainingModel.add(
  domainId, title, content, owner,  // owner 来自 JWT uid
  dag, description, pin
);
```

**权限：** `PERM.PERM_CREATE_TRAINING`

---

## 三、CLI 命令设计

### 通用输入方式

所有带复杂参数的命令统一支持三种输入方式：

```bash
# 方式1：从文件读取（主要方式）
hydrooj-cli contest create --file contest.json

# 方式2：从 stdin 读取（适合管道）
cat contest.json | hydrooj-cli contest create --stdin

# 方式3：直接传 JSON 字符串（Agent 最常用，不需要先写文件）
hydrooj-cli contest create --json '{"title":"Weekly 42","rule":"acm",...}'
```

三个通用 flag：
- `--file <path>` — 从本地文件读取 JSON/YAML
- `--stdin` — 从管道读取 JSON（stdin 不是 TTY 时自动启用）
- `--json <string>` — 直接传 JSON 字符串

优先級：`--json` > `--file` > `--stdin`

---

### `problem upload`

```bash
hydrooj-cli problem upload <zipPath> [options]

Options:
  --title       string   题目标题
  --tags        string   逗号分隔标签
  --difficulty  number   难度 0-5
  --pid         string   指定 pid，留空自动分配
  --hidden              隐藏题目
```

**特殊说明：** zip 文件作为 positional argument 传入，通过 `multipart/form-data` 上传，不走 `--file` 机制。
其余字段（title、tags 等）可放在同一个 JSON 中，通过 `--json` 或 `--file` 传入。

---

### `contest create`

```bash
hydrooj-cli contest create [options]

# 示例（Agent 最常用）
hydrooj-cli contest create --json '{
  "title": "Weekly Contest 42",
  "rule": "acm",
  "beginAt": "2026-04-01T10:00:00+08:00",
  "endAt": "2026-04-01T13:00:00+08:00",
  "pids": [1, 2, 3, 4],
  "langs": ["cpp", "java", "python"]
}'
```

---

### `homework create`

```bash
hydrooj-cli homework create --json '{
  "title": "Chapter 3 Homework",
  "beginAt": "2026-04-01T00:00:00+08:00",
  "endAt": "2026-04-07T23:59:59+08:00",
  "pids": [5, 6, 7],
  "penaltyRules": { "24": 0.75, "48": 0.5 }
}'
```

---

### `training create`

```bash
hydrooj-cli training create --json '{
  "title": "Algorithm Basics",
  "content": "A structured curriculum for beginners.",
  "dag": [
    {"_id": 1, "title": "Getting Started", "requireNids": [], "pids": [101]},
    {"_id": 2, "title": "Sorting", "requireNids": [1], "pids": [102, 103]}
  ]
}'
```

---

## 四、文件变更清单

### addon/

| 文件 | 变更 |
|---|---|
| `routes.ts` | 新增 4 个 POST handler |

### cli/ts/

| 文件 | 变更 |
|---|---|
| `index.ts` | 新增 4 个 CLI 命令 + `uploadProblemMultipart()` 辅助函数 |

---

## 五、权限一览

| 操作 | 所需权限 | JWT payload 来源 |
|---|---|---|
| 上传题目 | `PERM.PERM_CREATE_PROBLEM` | `uid` |
| 创建比赛 | `PERM.PERM_CREATE_CONTEST` | `uid` |
| 创建作业 | `PERM.PERM_CREATE_HOMEWORK` 或 `PERM.PERM_CREATE_CONTEST` | `uid` |
| 创建训练计划 | `PERM.PERM_CREATE_TRAINING` | `uid` |

---

## 六、优先级

1. **P0 — 题目上传**（Agent 最高频需求）
2. **P1 — 作业创建**（教学场景最常用）
3. **P1 — 比赛创建**（参数最多，结构最复杂）
4. **P2 — 训练计划创建**（DAG 结构，需验证循环依赖）

---

## 七、暂不在范围内的功能

- 题目更新（PUT problem/:id）
- 比赛/作业内容更新
- 训练计划追加题目或节点
- 代码提交（Agent 做题）
- 训练计划文件上传
