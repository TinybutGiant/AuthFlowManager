# User Guide Status Sync Implementation

## 概述

这个实现为AuthFlowManager项目添加了用户导游状态同步功能。当管理员批准导游申请时，系统会自动更新主数据库中的用户导游状态。

## 新增功能

### 1. 数据库表结构

在 `shared/main-schema.ts` 中新增了 `main_users` 表：

```typescript
export const mainUsers = pgTable("main_users", {
  id: serial("id").primaryKey(),
  is_guide: boolean("is_guide").notNull().default(false),
});
```

### 2. 用户状态同步功能

在 `server/storage.ts` 中新增了以下方法：

- `getMainUser(id: number)` - 获取主数据库中的用户信息
- `createMainUser(user: InsertMainUser)` - 创建新用户
- `updateMainUser(id: number, updates: UpdateMainUser)` - 更新用户信息
- `updateUserGuideStatus(userId: number, isGuide: boolean)` - 更新用户导游状态

### 3. 自动同步逻辑

在 `server/routes.ts` 中的导游申请审批流程中，当管理员执行以下操作时会自动同步用户状态：

- **批准申请** (`approve`): 将用户的 `is_guide` 状态设置为 `true`
- **拒绝申请** (`reject`): 将用户的 `is_guide` 状态设置为 `false`

## 使用方法

### 1. 数据库迁移

首先需要在主数据库中创建 `main_users` 表：

```sql
CREATE TABLE IF NOT EXISTS main_users (
    id SERIAL PRIMARY KEY,
    is_guide BOOLEAN NOT NULL DEFAULT false
);
```

### 2. 环境配置

确保 `MAIN_DATABASE_URL` 环境变量已正确配置，指向主数据库。

### 3. 测试功能

可以运行测试脚本来验证功能：

```bash
node test-user-sync.js
```

## API 端点

### 更新用户导游状态

```typescript
// 通过storage直接调用
await storage.updateUserGuideStatus(userId, true); // 设置为导游
await storage.updateUserGuideStatus(userId, false); // 取消导游状态
```

## 错误处理

- 如果用户状态更新失败，系统会记录错误日志但不会中断审批流程
- 所有用户状态更新操作都包含在 try-catch 块中，确保系统稳定性

## 注意事项

1. 确保主数据库连接正常
2. 用户ID必须存在于 `main_users` 表中
3. 如果用户不存在，需要先创建用户记录
4. 建议在生产环境中添加适当的日志记录和监控

## 文件修改清单

- `shared/main-schema.ts` - 新增用户表定义和类型
- `server/storage.ts` - 新增用户操作方法
- `server/routes.ts` - 修改审批逻辑，添加状态同步
- `test-user-sync.js` - 测试脚本
- `create-main-users-table.sql` - 数据库迁移脚本
