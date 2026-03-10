# Mumu Bookkeeping (木木记账)

## 项目简介
一款具备屏幕内容识别实现自动记账的智能手机记账软件，同时支持极客用户使用 JavaScript 编写自定义的计划任务。

## 核心特性
1. **自动记账 (Android)**: 基于 `AccessibilityService` 捕获支付软件付款结果页面，自动解析金额和商户，实现无感记账。
2. **自定义任务沙箱**: 允许在应用内编写并执行 JS 脚本进行周期性批量操作或数据处理，后端采用安全的沙箱隔离机制运行代码。

## 技术栈选择 (Tech Stack)

### 客户端 (Client)
- React Native 0.73+
- TypeScript
- Zustand (状态管理)
- Native Modules (Java/Kotlin) 处理无障碍权限

### 服务端 (Server)
- Node.js (NestJS / Express)
- PostgreSQL + Prisma ORM
- isolated-vm (V8 沙箱，保障 JS 代码执行安全)

## 架构速览

```text
mumu-bookkeeping/
├── app/             # React Native 客户端侧代码
├── server/          # Node.js 后端代码 (API + 沙箱执行器)
└── docs/            # 设计文档、打点及权限指南
```
