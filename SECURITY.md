# 安全升级：REST API 权限检查

> 当前状态：所有 REST handler 只验证了 JWT token 的身份，没有做权限检查。
> 目标：在新的写操作上线前，补全权限检查逻辑。

---

## 问题分析

### 现状

现有的 `verifyToken()` 只返回一个 plain object：
```typescript
// addon/routes.ts
function verifyToken(auth: string | undefined) {
    if (!auth?.startsWith('Bearer ')) return null;
    return verifyTokenStr(auth.slice(7), JWT_SECRET) as { uid: number; uname: string; domainId: string } | null;
}
```

调用处只检查了 `user` 是否为 null（未授权），但不检查权限（已授权但权限不足）。

### 风险

Hydro 的 Model 层本身不做权限检查，权限检查在 Handler 层：

```typescript
// Hydro 原生 handler（handler/training.ts）
this.checkPerm(PERM.PERM_CREATE_TRAINING);  // ← 权限检查
await training.add(domainId, title, content, this.user._id, dag, ...);  // ← Model
```

如果我们的 addon 不做权限检查，任何持有有效 token 的用户都可以：
- 上传题目（即使没有 `PERM_CREATE_PROBLEM`）
- 创建比赛/作业/训练计划（即使没有对应权限）

---

## 修复方案

### 核心改动

在每个写操作 handler 的开头：

```typescript
// 1. 验证 token（已有）
const user = verifyToken(this.request.headers.authorization);
if (!user) { /* 401 */ return; }

// 2. 加载完整 User 对象（含 hasPerm 方法）
const udoc = await M().user.getById(user.domainId, user.uid);
if (!udoc) { /* 401 */ return; }

// 3. 权限检查
if (!udoc.hasPerm(M().builtin.PERM.PERM_CREATE_PROBLEM)) {
    this.response.status = 403;
    this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_CREATE_PROBLEM' };
    return;
}
```

### 需要检查权限的操作

**读操作：**

| 操作 | 所需权限 | 错误响应 |
|---|---|---|
| `GET /rest-api/problems` | `PERM.PERM_VIEW_PROBLEM` | HTTP 403 |
| `GET /rest-api/problems/:id` | `PERM.PERM_VIEW_PROBLEM` | HTTP 403 |
| `GET /rest-api/submissions` | `PERM.PERM_VIEW_RECORD` | HTTP 403 |
| `GET /rest-api/contests` | `PERM.PERM_VIEW_CONTEST` | HTTP 403 |
| `GET /rest-api/homework` | `PERM.PERM_VIEW_HOMEWORK` | HTTP 403 |
| `GET /rest-api/trainings` | `PERM.PERM_VIEW_TRAINING` | HTTP 403 |

**写操作：**

| 操作 | 所需权限 | 错误响应 |
|---|---|---|
| `POST /rest-api/problems` (upload) | `PERM.PERM_CREATE_PROBLEM` | HTTP 403 |
| `POST /rest-api/contests` | `PERM.PERM_CREATE_CONTEST` | HTTP 403 |
| `POST /rest-api/homework` | `PERM.PERM_CREATE_HOMEWORK` or `PERM.PERM_CREATE_CONTEST` | HTTP 403 |
| `POST /rest-api/trainings` | `PERM.PERM_CREATE_TRAINING` | HTTP 403 |

> **登录：** 所有操作都需要有效 JWT token，无 token → HTTP 401

### 关于读操作

所有 API（GET + POST）都需要登录，权限与 HydroOJ 账号体系完全同步。

理由：
- CLI 有 login 命令，不是匿名工具
- Guest 用户在网页端能看公开题库，但**付费/私有内容**受权限保护
- Agent 操作时必须用有权限的账号，权限应与网页端一致

因此：
- 所有 endpoint 都需要身份验证（无 token → 401）
- GET 还需要读权限（如 `PERM_VIEW_PROBLEM`），否则 403
- POST 还需要写权限（如 `PERM_CREATE_PROBLEM`），否则 403

---

## 文件变更

**`addon/routes.ts`**

1. 新增 `requireAuth()` 辅助函数：验证 token + 加载 User 对象
2. 新增 `requirePerm(perm)` 辅助函数：检查权限
3. 在所有 POST handler 开头调用这两个函数

```typescript
// 新增辅助函数
async function requireAuth(): Promise<{ uid: number; uname: string; domainId: string; udoc: any } | null> {
    const user = verifyToken(this.request.headers.authorization);
    if (!user) return null;
    const udoc = await M().user.getById(user.domainId, user.uid);
    if (!udoc) return null;
    return { ...user, udoc };
}

function requirePerm(udoc: any, perm: bigint): boolean {
    return udoc.hasPerm(perm);
}
```

---

## 错误响应格式

统一使用：

```json
{
    "error": "FORBIDDEN",
    "message": "Missing permission: PERM_CREATE_CONTEST"
}
```

HTTP Status Code：`401 Unauthorized`（token 无效/过期）、`403 Forbidden`（token 有效但权限不足）

---

## PR 目标

- Branch: `security/permission-check`
- 先于功能开发合并此 PR
- 确保没有写操作 handler 遗漏权限检查
