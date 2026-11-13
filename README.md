# 充电站月度核算平台（FastAPI + PostgreSQL + React）

把**物业总表读数、设备累计读数、充电订单、分时电价**四类数据接起来，按站点时区与电价生效边界
逐段拆分、同范围核对，生成物业与站方可以逐段对账的月度账单。系统**不接真实电表、不发起扣款**，
只做数据核对、账单计算与依据留痕。

## 一、业务规则与实现位置

| 规则（题目要求） | 实现方式 |
| --- | --- |
| 导入保留原始文件与行号，按来源记录号识别重复 | `import_files` 落盘原件+sha256；`import_rows` 保存物理行号与原始行文本；`source_records`+`record_revisions` 按 `(站点, 来源类型, record_no)` 管理版本 |
| 同号内容变化进修订，不覆盖已被账单采用的数据 | 未采用：新版本 applied、旧版本 superseded；已采用：新版本 `blocked_adopted`，下一轮核算前才提升（`services/importer.py`） |
| 时间先转站点时区，再按电价边界拆区间 | 存储统一 UTC，展示用站点本地时间；`tariff_svc.tariff_boundaries` 生成本地午夜/分时切换/电价版本边界 |
| 读数差值与订单用电在相同范围比较 | 以总表相邻读数构成计量区间，设备表/订单/公共负荷按时长裁剪到同一区间后比较（`reconciliation.py`） |
| 跨电价时段缺中间计量值只能出估算项 | 有边界中间读数→实测拆分；否则把**已知总电量**按持续时间拆分并标注 `estimated`；缺起止读数且无上报值→`pending` 待补，绝不按时间编电量 |
| 保留充电、经确认公共负荷、未解释差额，不按订单摊平 | 账单三类成分分列；未确认公共负荷生成物业核对事项且不计入；未解释差额超站点阈值→账单挂起，不自动归零 |
| 读数回退先查设备更换，无依据整段挂起、不产生负电量 | `build_spans`：有换表记录且首尾读数齐全→桥接计算；否则 `suspended`，并生成运营核对事项 |
| 同设备重复上报只计一次；不同订单抢同一时段交运营确认 | 完全同时段→停用重复单+核对事项；部分重叠→`order_conflicts`，确认前两张单都不计入 |
| 作业冻结读数/电价/订单/规则，重跑沿用相同输入，执行期更正留下一轮 | `job_inputs` 快照 + 实体 `adopted_by_job_id`；重跑复制快照且电价查询限定冻结版本；期间更正自动 blocked |
| 确认前检查新修订；已确认账单只做差额更正 | `billing.check_new_revisions`（含 blocked 修订）阻止确认；`bill_adjustments` 保留原值、以 delta 更正，不替换原字段 |
| 物业只能处理分配给自己的核对事项 | JWT 角色 + `user_sites` 授权范围，后端每个接口强制校验（`deps.py`） |
| 金额小数精度 | 金额按 4 位小数 `ROUND_HALF_UP` 计算（展示 2 位），电量 4 位；拆分尾差并入末段保证合计守恒 |

## 二、目录结构

```
16/
├── docker-compose.yml          # 一键启动 pg + backend + frontend
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py             # FastAPI 入口（启动自动建表，/docs Swagger UI）
│   │   ├── models.py           # 原件索引/修订/计算依据/结算修订 四层表
│   │   ├── importer 服务 / reconciliation 引擎 / tariff / billing / security / deps
│   │   ├── routers/            # auth sites imports jobs bills tasks conflicts source-records entities
│   │   └── seed.py             # 账号、站点、样例数据幂等播种
│   ├── sample_data/            # 两站点样例 CSV（含生成器 generate_samples.py）
│   └── tests/                  # pytest 19 个用例
└── frontend/
    ├── Dockerfile + nginx.conf # 静态构建 + SPA/API 反代
    └── src/pages/              # 登录、账单下钻、作业、导入、核对事项、冲突、实体查询
```

## 三、一键启动（Docker Compose）

```bash
cd /workspace/16
docker compose up --build
```

- 前端：http://localhost:8080
- 后端 API：http://localhost:8077 ，Swagger UI：http://localhost:8077/docs
- PostgreSQL：localhost:5432（库/用户/密码 `ccdev`/`ccdev`/`ccdev`，库名 `charging_settlement`）
- 后端容器启动时自动建表并幂等播种账号、站点与样例数据。
- 国内网络构建可传镜像源：
  `docker compose build --build-arg PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple --build-arg NPM_REGISTRY=https://registry.npmmirror.com`

## 四、本地开发启动（无 Docker 时）

前置：本机 PostgreSQL 已建库（本隔离环境为 127.0.0.1:5432）。

```bash
# 1. 后端
cd backend
/opt/python-3.12/bin/python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python sample_data/generate_samples.py     # 生成两站点样例 CSV
.venv/bin/python -m app.seed                         # 建表 + 账号 + 导入样例
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8077

# 2. 前端（另开终端）
cd frontend
/opt/node-22/bin/npm install --cache /tmp/npm-cache
/opt/node-22/bin/npm run dev                         # http://127.0.0.1:5173 ，/api 自动代理到 8077
```

## 五、测试账号

| 角色 | 用户名 | 密码 | 权限 |
| --- | --- | --- | --- |
| 平台财务 | `finance` | `Finance@123` | 全部站点；导入、发起/重跑核算、确认账单、登记差额更正 |
| 运营 | `operator` | `Operator@123` | 导入；处理订单冲突、回退/换表/重复订单核对事项 |
| 上海物业 | `property_sh` | `Property@123` | 仅 S01，只能看到/回复分配给 property 的核对事项 |
| 乌鲁木齐物业 | `property_xj` | `Property@123` | 仅 S02，同上 |

## 六、样例数据覆盖的场景（均被测试与冒烟实际执行）

- **S01 上海（Asia/Shanghai，UTC+8）**：周读数总表 2600kWh；订单跨 peak/flat 且有 10:00 中间计量→实测拆分；
  跨 peak/valley 无中间计量→估算拆分；断网订单 `OR-SH-009` 先只报电量、后补起止读数（同号修订生效）；
  已确认公共照明 320kWh；两个电价版本 10-15 切换；未解释差额 30kWh（1.15%，阈值内，账单可确认）；
  作业后到达的同号更正 `orders_v3_after_adopt.csv` 演示 blocked_adopted。
- **S02 乌鲁木齐（Asia/Urumqi，UTC+6）**：M-C 换表带首尾读数→桥接 1650kWh；M-E 读数回退无换表依据→整段挂起；
  完全同时段重复订单只计一次；部分重叠订单冲突（运营确认前均不计）；无任何依据订单→待补；
  公共负荷未确认→物业核对事项、不计入；未解释差额 250kWh（7.81% > 2% 阈值）→账单挂起不可确认。

## 七、验证方式与实际验证结论

以下均为在本隔离环境**实际执行过**的验证（2026-11-13）：

1. **后端单元/规则测试**：`cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests -q`
   → **19 passed**。覆盖：原件行号留存、同号重复、修订生效、采用后 blocked 不覆盖、时区边界实测拆分、
   估算/待补标注、回退挂起不负电量、换表桥接、重复/冲突订单、未解释差额与阈值挂起、重跑输入冻结、
   重跑不受作业后新电价影响、金额精度与合计守恒、物业站点隔离、确认前修订拦截、差额更正原值保留、冲突处理。
2. **HTTP 端到端冒烟**（真实 uvicorn 进程 + curl）：登录四角色 → 发起两站点核算（S01 completed / S02 suspended）
   → 账单下钻（4 区间、11 拆分段）→ 挂起账单确认返回 409 → S01 账单确认成功 → 差额更正保留原值
   （delta=-4.9999，原字段不变）→ 乌鲁木齐物业回复核对事项 → 上海物业跨站回复返回 403
   → 运营解决订单冲突 → 来源记录修订链 `[(1, applied), (2, applied)]`，全部通过。
3. **前端**：`npm run build` TypeScript 类型检查与生产构建成功；Vite dev 启动后首页 200、
   `/api` 代理登录与 health 验证通过。
4. **Docker**：本隔离容器未安装 docker 守护进程，`Dockerfile`/`docker-compose.yml` 已交付但**未在此环境实际构建运行**；
   配置依据上述已验证的本地启动步骤编写，启动命令与端口见第三节。

## 八、主要 API 一览（详见 /docs Swagger UI）

- `POST /api/auth/login` 登录获取 JWT
- `POST /api/imports` 上传 CSV（multipart：site_id、source_type、file）；`GET /api/imports/files/{id}/rows` 原件逐行
- `POST /api/jobs` 发起核算（周期为站点本地时间，支持 `rerun_of_job_id` 冻结重跑）
- `GET /api/jobs/{id}/intervals`、`/splits` 区间与订单拆分下钻
- `GET /api/bills`、`/api/bills/{id}/precheck`、`/confirm`、`/adjustments`
- `GET /api/tasks`、`POST /api/tasks/{id}/respond` 核对事项（后端按角色与站点授权过滤）
- `GET /api/conflicts`、`POST /api/conflicts/{id}/resolve` 订单冲突
- `GET /api/source-records`、`/{id}/revisions` 来源记录与修订链
- `GET /api/entities/readings|orders|public-loads|replacements` 原始依据查询

## 九、CSV 列格式

所有文件首行为表头，必须含 `record_no`（来源记录号）。完整示例见 `backend/sample_data/S01`、`S02`：

- 读数（master_reading / device_reading）：`record_no,meter_no,device_id,reading_time,reading_kwh,is_correction`
- 订单 order：`record_no,order_no,device_id,start_time,end_time,start_reading,end_reading,reported_energy`
- 电价 tariff：`record_no,tariff_name,effective_date,end_date,segment_name,start_hour,end_hour,price`（一个 record_no 可含多个分时段行）
- 公共负荷 public_load：`record_no,load_name,start_time,end_time,energy_kwh,confirmed`
- 换表 replacement：`record_no,meter_no,effective_time,old_final_reading,new_initial_reading,evidence_note`
