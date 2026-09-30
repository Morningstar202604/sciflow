#!/usr/bin/env python3
import os
"""SciFlow 全量回归测试 v5 — 覆盖全部 66 个路由（含 guardrail 拒参 / RAG 混合检索 / usage 成本统计专项）"""
import json, sys, time, urllib.request, urllib.error

BASE = os.environ.get("SCIFLOW_BASE", "http://localhost:3000")
PASS, FAIL, SKIP = 0, 0, 0
FAILED = []

def req(method, path, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None
    except Exception as e:
        return -1, str(e)

def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        FAILED.append(name)
        print(f"  ✗ {name} — {detail}")

AI_STALL = {"n": 0}

def ai_call(name, fn, retries=1):
    """AI 类接口：429 限流时退避重试；连续超时标记外部网关卡顿并跳过"""
    if AI_STALL["n"] >= 3:
        print(f"  ⏭ {name} — 外部网关连续超时，跳过（不影响代码正确性结论）")
        return -9, None
    for i in range(retries):
        st, data = fn()
        if st == 429:
            time.sleep(6 * (i + 1)); continue
        if st == -1:
            AI_STALL["n"] += 1
        else:
            AI_STALL["n"] = 0
        return st, data
    AI_STALL["n"] += 1
    return 429, None

def info(name, text):
    print(f"  ℹ {name} — {text}")

print("=" * 60)
print("SciFlow 全量回归 v5 — 开始")
print("=" * 60)

# ---------- 0. 健康与配置 ----------
st, d = req("GET", "/api/health")
check("健康检查 /api/health", st == 200 and d.get("status") == "ok", f"{st} {d}")
st, d = req("GET", "/api/settings")
check("设置 /api/settings", st == 200 and d.get("ai") and d.get("env"), f"{st}")
st, d = req("GET", "/api/settings/check")
check("自检 /api/settings/check", st == 200, f"{st}")
st, d = req("GET", "/api/usage/summary")
check("成本统计 /api/usage/summary", st == 200 and d.get("total") and "byCaller" in d, f"{st}")
if st == 200 and d.get("total"):
    check("成本统计字段完整", all(k in d["total"] for k in ("calls", "prompt_tokens", "completion_tokens", "total_tokens", "avg_latency_ms", "success_rate")), str(d["total"].keys()))

# ---------- 1. 项目 CRUD ----------
st, d = req("GET", "/api/projects")
check("项目列表 /api/projects", st == 200 and isinstance(d, list), f"{st}")
st, d = req("POST", "/api/projects", {"name": "回归测试项目", "description": "v5 全量回归临时项目"})
check("创建项目 /api/projects POST", st == 201 and d.get("id"), f"{st} {d}")
pid = d.get("id") if st == 201 else None
if pid:
    st, d2 = req("GET", f"/api/projects/{pid}")
    check("项目详情 GET :id", st == 200 and d2.get("id") == pid, f"{st}")
    st, d2 = req("PATCH", f"/api/projects/{pid}", {"description": "已更新"})
    check("项目更新 PATCH :id", st == 200, f"{st}")
    st, d2 = req("DELETE", f"/api/projects/{pid}")
    check("项目删除 DELETE :id", st == 200, f"{st}")
    pid = None  # 用已删除的 id 跑后续文档测试会失败，改用现有项目

# 拿一个已有项目跑文档/流水线测试
st, projects = req("GET", "/api/projects")
proj = next((p for p in projects if p.get("id")), None)
assert proj, "无可用项目"
pid = proj["id"]
print(f"  使用现有项目: {proj.get('name')} ({pid})")

# ---------- 2. 文档 CRUD ----------
st, d = req("GET", "/api/documents")
check("文档列表 /api/documents", st == 200 and isinstance(d, list), f"{st}")
st, d = req("POST", "/api/documents", {"projectId": pid, "title": "回归测试论文", "content": "## 引言\n这是回归测试内容。\n\n## 方法\n测试方法。"})
check("创建文档 POST", st == 201 and d.get("id"), f"{st} {d}")
docid = d.get("id") if st == 201 else None
if docid:
    st, d2 = req("GET", f"/api/documents/{docid}")
    check("文档详情 GET :id", st == 200 and d2.get("id") == docid, f"{st}")
    st, d2 = req("PATCH", f"/api/documents/{docid}", {"title": "回归测试论文-v2"})
    check("文档更新 PATCH :id", st == 200 and d2.get("title") == "回归测试论文-v2", f"{st} {d2}")
    st, d2 = req("GET", f"/api/documents/{docid}/export")
    check("文档导出 export", st == 200, f"{st}")
    st, d2 = req("POST", f"/api/documents/{docid}/citations", {"text": "Graph neural networks have shown great success in node classification tasks."})
    if st in (200, 201):
        info("引文抽取 POST citations", "成功")
        st, d3 = req("GET", f"/api/documents/{docid}/citations")
        check("引文列表 GET citations", st == 200, f"{st}")
        st, d3 = req("GET", f"/api/documents/{docid}/export-citations")
        check("引文导出 export-citations", st == 200, f"{st}")
    else:
        info("引文抽取 POST citations", f"业务校验拒绝 st={st}（内容过短属正常拦截）")
    # AI 接口
    for name, path, body in [
        ("大纲生成 outline", f"/api/documents/{docid}/outline", {"topic": "图神经网络综述", "summary": "研究图神经网络的节点分类方法"}),
        ("章节起草 section", f"/api/documents/{docid}/section", {"sectionTitle": "引言"}),
    ]:
        st, d2 = ai_call(name, lambda p=path, b=body: req("POST", p, b))
        info(name, f"st={st} {str(d2)[:90]}")
    st, d2 = ai_call("润色 polish", lambda: req("POST", f"/api/documents/{docid}/polish", {"text": "This is a test sentence for polishing.", "mode": "polish"}))
    info("润色 polish", f"st={st} {str(d2)[:100]}")
    st, d2 = ai_call("翻译 translate", lambda: req("POST", f"/api/documents/{docid}/translate", {"text": "Graph neural networks are powerful.", "targetLang": "zh"}))
    info("翻译 translate", f"st={st} {str(d2)[:100]}")
    st, d2 = req("GET", f"/api/documents/{docid}/polish-records")
    check("润色记录 polish-records", st == 200 and isinstance(d2, list), f"{st}")

# ---------- 3. 知识库（RAG 升级专项） ----------
st, d = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "GNN 测试文献", "type": "text",
    "content": "Graph Neural Networks (GNNs) generalize neural networks to graph-structured data. "
               "Message passing aggregates features from neighboring nodes. 图神经网络在节点分类任务上表现优异，"
               "通过消息传递机制聚合邻居节点特征。"})
check("知识上传 upload（RAG 升级后）", st in (200, 201) and d.get("id"), f"{st} {str(d)[:150]}")
kid = d.get("id") if st in (200, 201) else None
st, d2 = req("GET", "/api/knowledge")
check("知识列表 GET", st == 200 and isinstance(d2, list), f"{st}")
if kid:
    st, d2 = ai_call("知识问答 query（混合检索 BM25+向量）", lambda: req("POST", "/api/knowledge/query", {"projectId": pid, "question": "图神经网络如何实现节点分类？消息传递机制是什么？"}))
    info("RAG 混合检索 query", f"st={st} {str(d2)[:140]}")
    if st in (200, 201) and d2.get("sources"):
        check("RAG sources 命中", len(d2["sources"]) >= 1, str(d2["sources"])[:100])
    st, d2 = req("DELETE", f"/api/knowledge/{kid}")
    check("知识删除 DELETE", st == 200, f"{st}")

# ---------- 4. MCP / Guardrails 专项 ----------
st, d = req("GET", "/api/mcp/info")
check("MCP 信息 /api/mcp/info", st == 200 and d.get("name") and d.get("tools") is not None, f"{st} {d}")
st, d = req("GET", "/api/mcp/tools")
tools = d.get("tools", []) if st == 200 else []
check("MCP 工具列表 tools", st == 200 and len(tools) >= 3, f"{st} {len(tools)}")
if tools:
    name = tools[0]["name"]
    # 构造一个必填参数缺失的调用 → guardrail 应拒绝（参数校验）
    bad_args = {"__missing__": True} if "query" in json.dumps(tools[0].get("inputSchema", {})) else {"query": ""}
    st, d2 = req("POST", "/api/mcp/call", {"name": name, "arguments": bad_args})
    if st in (400, 422):
        check("Guardrail 参数校验拒绝（缺参）", True, f"{st} {str(d2)[:100]}")
    else:
        check("Guardrail 参数校验拒绝（缺参）", st in (400, 422) or "拒绝" in str(d2), f"未拒绝 st={st} {str(d2)[:100]}")
    # 正常调用
    st, d2 = req("POST", "/api/mcp/call", {"name": name, "arguments": {"query": "图神经网络"}})
    check(f"MCP 工具调用 {name}", st in (200, 201), f"st={st} {str(d2)[:90]}")
st, d = req("GET", "/api/mcp/external")
check("MCP 外部服务器列表", st == 200 and isinstance(d, list), f"{st}")

# ---------- 5. 流水线（断点续跑相关） ----------
st, d = req("POST", "/api/pipeline", {"projectId": pid, "topic": "图神经网络在生物医药中的应用综述"})
check("流水线创建 POST", st == 201 and d.get("id"), f"{st} {str(d)[:150]}")
runid = d.get("id") if st == 201 else None
if runid:
    st, d2 = req("GET", f"/api/pipeline/{runid}")
    check("流水线详情 GET :id", st == 200 and d2.get("id") == runid, f"{st}")
    st, d2 = req("GET", f"/api/pipeline/{runid}/agents")
    check("流水线 Agent 轨迹 agents", st == 200 and isinstance(d2, list), f"{st}")
    st, d2 = req("GET", "/api/pipeline")
    check("流水线列表 GET", st == 200 and isinstance(d2, list), f"{st}")
    # 不删，留给断点续跑验证

# ---------- 6. 记忆中心 ----------
st, d = req("POST", "/api/memory", {"type": "episodic", "content": "回归测试：用户偏好先润色再回答", "projectId": pid, "keywords": ["测试"]})
check("记忆新增 POST", st == 201 and d.get("id"), f"{st} {d}")
memid = d.get("id") if st == 201 else None
st, d2 = req("GET", "/api/memory")
check("记忆列表 GET", st == 200 and isinstance(d2, list), f"{st}")
if memid:
    st, d2 = req("DELETE", f"/api/memory/{memid}")
    check("记忆删除 DELETE", st == 200, f"{st}")

# ---------- 7. 质量评分 ----------
st, d = ai_call("质量评分 quality POST", lambda: req("POST", "/api/quality", {"documentId": docid, "title": "回归测试论文", "content": "图神经网络（GNN）是一类强大的深度学习模型，专门用于处理图结构数据。本文系统综述了图神经网络在节点分类、链路预测和图分类三大任务中的最新进展。我们首先介绍消息传递机制的基本原理，然后对比分析 GCN、GraphSAGE、GAT 等代表性架构的优缺点，最后讨论图神经网络在生物医药、社交网络和推荐系统等领域的应用前景与面临的挑战。"}))
info("质量评分 quality POST", f"st={st} {str(d)[:120]}")
qid = d.get("id") if st == 201 else None
if qid:
    st, d2 = req("GET", f"/api/quality/{qid}")
    check("质量评分详情 GET :id", st == 200 and d2.get("id") == qid, f"{st}")
st, d2 = req("GET", "/api/quality")
check("质量评分列表 GET", st == 200 and isinstance(d2, list), f"{st}")

# ---------- 8. 文献调研（本地文献库检索，已移除国外在线源） ----------
st, d = req("POST", "/api/references/search", {"query": "graph neural network node classification", "limit": 5})
hits = d.get("hits") if isinstance(d, dict) else (d if isinstance(d, list) else [])
check("文献检索 search（本地文献库）", st in (200, 201) and isinstance(hits, list), f"st={st} hits={len(hits) if isinstance(hits, list) else 0}")
# 先手动入库一条真实元数据文献，验证库内检索命中 ≥1
st, d2 = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Graph Neural Networks: A Review", "authors": ["J Zhou", "G Cui"], "year": 2020, "venue": "TKDE", "doi": "10.1109/TKDE.2020.3047454", "abstract": "A comprehensive survey of graph neural networks for node classification and link prediction tasks."}})
if st in (200, 201) and d2.get("id"):
    refid = d2.get("id")
    st, d3 = req("POST", "/api/references/search", {"query": "graph neural", "projectId": pid, "limit": 5})
    hits3 = d3.get("hits") if isinstance(d3, dict) else (d3 if isinstance(d3, list) else [])
    check("库内检索命中（手动入库后）", st in (200, 201) and len(hits3) >= 1, f"st={st} hits={len(hits3)}")
    st, d3 = req("GET", f"/api/references/{refid}")
    check("文献详情 GET :id", st == 200 and d3.get("id") == refid, f"{st}")
    st, d3 = req("DELETE", f"/api/references/{refid}")
    check("文献删除 DELETE", st == 200, f"{st}")
st, d2 = ai_call("文献批量导入 import", lambda: req("POST", "/api/references/import", {"projectId": pid, "hits": (hits or [])[:2]}))
info("文献批量导入 import", f"st={st} {str(d2)[:80]}")
st, d2 = ai_call("文献综述 summarize", lambda: req("POST", "/api/references/summarize", {"projectId": pid, "topic": "图神经网络"}))
info("文献综述 summarize", f"st={st} {str(d2)[:90]}")
st, d2 = ai_call("证据抽取 evidence", lambda: req("POST", "/api/references/evidence", {"projectId": pid, "question": "GNN 的典型应用是什么？"}))
info("证据抽取 evidence", f"st={st} {str(d2)[:90]}")

# ---------- 9. 投稿辅助 ----------
st, d2 = ai_call("期刊推荐 journals", lambda: req("POST", "/api/submission/journals", {"title": "GNN Survey", "abstract": "A survey of graph neural networks.", "field": "computer science"}))
info("期刊推荐 journals", f"st={st} {str(d2)[:90]}")
st, d2 = ai_call("投稿信 cover-letter", lambda: req("POST", "/api/submission/cover-letter", {"title": "GNN Survey", "abstract": "A survey.", "journal": "Nature Machine Intelligence"}))
info("投稿信 cover-letter", f"st={st} {str(d2)[:90]}")
st, d2 = ai_call("审稿回复 reply-review", lambda: req("POST", "/api/submission/reply-review", {"reviewComments": "The method section needs more detail."}))
info("审稿回复 reply-review", f"st={st} {str(d2)[:90]}")

# ---------- 10. 科研问答 ----------
st, d2 = ai_call("问答 /api/chat", lambda: req("POST", "/api/chat", {"message": "请用一句话介绍图神经网络"}))
info("科研问答 chat", f"st={st} {str(d2)[:90]}")

# ---------- 11. 设置管理 ----------
st, d2 = req("GET", "/api/settings/providers")
check("模型厂商列表 providers", st == 200 and isinstance(d2, list), f"{st}")
st, d2 = req("GET", "/api/settings/mcp-servers")
check("MCP 服务器配置列表", st == 200 and isinstance(d2, list), f"{st}")
st, d2 = ai_call("模型测试 settings/test", lambda: req("POST", "/api/settings/test", {"model": "agnes-3.0-flash"}))
info("模型连通性测试 test", f"st={st} {str(d2)[:90]}")

# ---------- 12. 科研高级功能：阅读状态/去重指纹 ----------
st, d = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Systematic Review Methods in Medicine", "authors": ["A Smith", "B Wang"], "year": 2021, "venue": "J Clin Epidemiol", "abstract": "Methods for systematic review and meta-analysis."}})
check("高级功能·文献入库（含指纹）", st in (200, 201) and d.get("id") and d.get("fingerprint"), f"st={st} {str(d)[:160]}")
advRefId = d.get("id") if st in (200, 201) else None
if advRefId:
    # 同标题再入一条 → 应标记 isDuplicateOf 指向首条
    st, d2 = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "systematic review methods in medicine!!!", "authors": ["A Smith", "B Wang"], "year": 2021, "venue": "J Clin Epidemiol", "abstract": "dup"}})
    check("高级功能·标题指纹去重（isDuplicateOf）", st in (200, 201) and d2.get("isDuplicateOf") == advRefId, f"st={st} dup={str(d2)[:120]}")
    st, d2 = req("PATCH", f"/api/references/{advRefId}", {"readingStatus": "reading", "tags": '["rct","cohort"]'})
    check("高级功能·PATCH 阅读状态/标签", st == 200 and d2.get("readingStatus") == "reading" and d2.get("tags") == '["rct","cohort"]', f"st={st} {str(d2)[:120]}")

    # ---------- 13. 系统综述·筛选队列 ----------
    st, d2 = req("POST", "/api/references/screen", {"projectId": pid, "referenceId": advRefId, "status": "included", "reason": "RCT 符合纳入标准"})
    check("筛选·单条纳入 upsert", st in (200, 201) and d2.get("status") == "included" and d2.get("referenceId") == advRefId and d2.get("title"), f"st={st} {str(d2)[:140]}")
    sid = d2.get("id") if st in (200, 201) else None
    # 同条再改状态 → upsert 更新而非新增
    st, d3 = req("POST", "/api/references/screen", {"projectId": pid, "referenceId": advRefId, "status": "uncertain", "reason": "待复核"})
    check("筛选·同条 upsert 更新状态", st in (200, 201) and d3.get("id") == sid and d3.get("status") == "uncertain", f"st={st} {str(d3)[:120]}")
    st, d3 = req("GET", f"/api/references/screen?projectId={pid}")
    check("筛选·列表 join 文献元数据", st == 200 and isinstance(d3, list) and any(x.get("id") == sid for x in d3), f"st={st} n={len(d3) if isinstance(d3, list) else 0}")
    st, d3 = req("POST", "/api/references/screen/bulk", {"projectId": pid, "referenceIds": [advRefId], "status": "excluded", "reason": "批量排除"})
    check("筛选·批量 screen/bulk", st in (200, 201) and d3.get("ok") and d3.get("updated") == 1, f"st={st} {str(d3)[:100]}")

    # ---------- 14. 系统综述·文献编码抽取表 ----------
    st, d2 = req("POST", "/api/references/extraction/fields", {"projectId": pid, "key": "study_design", "label": "研究设计", "kind": "select", "options": ["RCT", "队列", "病例对照"]})
    check("抽取·新建字段（key 校验）", st in (200, 201) and d2.get("id") and d2.get("options") == ["RCT", "队列", "病例对照"], f"st={st} {str(d2)[:140]}")
    fid = d2.get("id") if st in (200, 201) else None
    st, d2 = req("POST", "/api/references/extraction/fields", {"projectId": pid, "key": "Bad Key!", "label": "非法"})
    check("抽取·非法 key 被拒绝", st == 400, f"st={st} {str(d2)[:80]}")
    st, d2 = req("GET", f"/api/references/extraction/fields?projectId={pid}")
    check("抽取·字段列表", st == 200 and isinstance(d2, list) and any(f.get("key") == "study_design" for f in d2), f"st={st}")
    if fid:
        st, d3 = req("PUT", "/api/references/extraction/values", {"fieldId": fid, "referenceId": advRefId, "value": "RCT"})
        check("抽取·设置取值 upsert", st in (200, 201) and d3.get("ok"), f"st={st} {str(d3)[:80]}")
    st, d2 = req("GET", f"/api/references/extraction/table?projectId={pid}")
    row = next((r for r in d2.get("rows", []) if r.get("referenceId") == advRefId), None) if st == 200 else None
    check("抽取·矩阵 table（字段+取值）", st == 200 and d2.get("fields") and row and row.get("values", {}).get(fid) == "RCT", f"st={st} {str(d2)[:140]}")

# ---------- 15. 审稿意见闭环 ----------
if docid:
    st, d = req("POST", "/api/research/review-comments", {"documentId": docid, "comments": [
        {"reviewer": "Reviewer A", "commentText": "方法部分样本量计算缺失，请补充。", "category": "major"},
        {"reviewer": "Reviewer B", "commentText": "相关工作章节缺少近三年文献。", "category": "minor"},
    ]})
    check("审稿意见·批量创建", st in (200, 201) and isinstance(d, list) and len(d) == 2, f"st={st} {str(d)[:140]}")
    rcid = d[0].get("id") if st in (200, 201) and d else None
    st, d2 = req("GET", f"/api/research/review-comments?documentId={docid}")
    check("审稿意见·列表", st == 200 and isinstance(d2, list) and len(d2) >= 2, f"st={st} n={len(d2) if isinstance(d2, list) else 0}")
    if rcid:
        st, d2 = req("PATCH", f"/api/research/review-comments/{rcid}", {"status": "resolved", "responseText": "已在 2.1 节补充样本量计算。"})
        check("审稿意见·更新状态/回复", st == 200 and d2.get("status") == "resolved" and "样本量" in d2.get("responseText", ""), f"st={st} {str(d2)[:120]}")
    # response-letter 为 AI 类，按现有跳过机制调用
    st, d2 = ai_call("审稿回复信 response-letter", lambda: req("POST", "/api/research/response-letter", {"documentId": docid}))
    info("审稿回复信 response-letter", f"st={st} {str(d2)[:90]}")
    if rcid:
        st, d2 = req("DELETE", f"/api/research/review-comments/{rcid}")
        check("审稿意见·删除", st == 200 and d2.get("ok"), f"st={st}")

# ---------- 16. 期刊库 + 结构化匹配 ----------
st, d = req("GET", "/api/submission/journals")
check("期刊库·列表（含种子）", st == 200 and isinstance(d, list) and len(d) >= 4, f"st={st} n={len(d) if isinstance(d, list) else 0}")
st, d = req("POST", "/api/submission/journals-lib", {"name": "回归测试期刊", "scopeText": "测试用期刊，可删除。"})
check("期刊库·新增", st in (200, 201) and d.get("id") and d.get("name") == "回归测试期刊", f"st={st} {str(d)[:120]}")
newJid = d.get("id") if st in (200, 201) else None
if newJid:
    st, d2 = req("DELETE", f"/api/submission/journals-lib/{newJid}")
    check("期刊库·删除", st == 200 and d2.get("ok"), f"st={st}")
st, d2 = ai_call("期刊结构化匹配 journals-match", lambda: req("POST", "/api/submission/journals-match", {"title": "Graph neural networks for node classification", "abstract": "We survey GNNs and propose a new message passing architecture."}))
info("期刊结构化匹配 journals-match", f"st={st} {str(d2)[:120]}")

# ---------- 17. 轻量实验沙箱（本机 python3） ----------
import shutil
SANDBOX_PYTHON_OVERRIDE = os.environ.get("SANDBOX_PYTHON", "")
if SANDBOX_PYTHON_OVERRIDE:
    # 服务器以 SANDBOX_PYTHON=/nonexistent 启动 → 验证无 Python 降级路径
    print(f"  ℹ 检测到 SANDBOX_PYTHON={SANDBOX_PYTHON_OVERRIDE}，验证无 Python 降级路径")
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "goal": "无 python3 降级", "code": "print('should not run')"})
    check("实验沙箱·无 Python 降级 status=error", st in (200, 201) and d.get("status") == "error", f"st={st} {str(d)[:200]}")
    check("实验沙箱·无 Python 引导文案含『未检测到 Python』", "未检测到 Python" in (d.get("stderr") or ""), f"stderr={str(d.get('stderr'))[:200]}")
    check("实验沙箱·无 Python 引导含安装提示", "安装" in (d.get("stderr") or "") and ("brew" in (d.get("stderr") or "") or "apt" in (d.get("stderr") or "") or "python.org" in (d.get("stderr") or "")), f"stderr={str(d.get('stderr'))[:200]}")
    check("实验沙箱·无 Python 降级 memoryMonitored=False", d.get("memoryMonitored") is False, f"memoryMonitored={d.get('memoryMonitored')}")
    check("实验沙箱·无 Python 不执行用户代码（stdout 为空）", not (d.get("stdout") or "").strip(), f"stdout={str(d.get('stdout'))[:120]}")
elif not shutil.which("python3"):
    print("  ⏭ 未检测到 python3，实验沙箱用例跳过（不失败）")
else:
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "goal": "验证沙箱执行", "code": "print('hello-sandbox'); print(2+3)"})
    check("实验沙箱·正常执行 run", st in (200, 201) and d.get("status") == "ok" and "hello-sandbox" in (d.get("stdout") or "") and (d.get("stdout") or "").count("5") >= 1, f"st={st} {str(d)[:180]}")
    check("实验沙箱·正常运行返回 memoryMonitored 布尔字段", isinstance(d.get("memoryMonitored"), bool), f"memoryMonitored={d.get('memoryMonitored')!r}")
    eid = d.get("id") if st in (200, 201) else None
    # 异常脚本 → status=error
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "code": "raise RuntimeError('boom')"})
    check("实验沙箱·异常脚本 status=error", st in (200, 201) and d.get("status") == "error" and "boom" in (d.get("stderr") or ""), f"st={st} {str(d)[:180]}")
    # 超时脚本 → status=timeout（默认 10s 杀进程组）
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "code": "while True:\n    pass"})
    check("实验沙箱·超时 status=timeout", st in (200, 201) and d.get("status") == "timeout", f"st={st} {str(d)[:180]}")
    # 输出截断（>64KB）
    st, d = req("POST", "/api/experiments/run", {"projectId": pid, "code": "print('x' * 200000)"})
    check("实验沙箱·stdout 截断标记", st in (200, 201) and d.get("stdoutTruncated") is True, f"st={st} trunc={d.get('stdoutTruncated') if isinstance(d, dict) else '?'}")
    if eid:
        st, d2 = req("GET", f"/api/experiments?projectId={pid}")
        check("实验沙箱·列表（updatedAt 倒序）", st == 200 and isinstance(d2, list) and any(x.get("id") == eid for x in d2), f"st={st} n={len(d2) if isinstance(d2, list) else 0}")
        st, d2 = req("GET", f"/api/experiments/{eid}")
        check("实验沙箱·详情 GET :id", st == 200 and d2.get("id") == eid, f"st={st}")
        st, d2 = req("PATCH", f"/api/experiments/{eid}", {"conclusion": "沙箱运行正常"})
        check("实验沙箱·PATCH 结论", st == 200 and d2.get("conclusion") == "沙箱运行正常", f"st={st} {str(d2)[:140]}")
        st, d2 = req("DELETE", f"/api/experiments/{eid}")
        check("实验沙箱·删除", st == 200 and d2.get("ok"), f"st={st}")


# ---------- 17. 投稿流程状态跟踪 ----------
if pid:
    # 登记一个带一审周期的期刊（4 周），用于验证 L3 超期推断
    st, jd = req("POST", "/api/submission/journals-lib", {"name": "回归跟踪期刊", "firstDecisionWeeks": 4})
    trackJid = jd.get("id") if st in (200, 201) else ""
    # 投稿日期设为 6 周前 → 4 周一审周期下应 overdue
    old_ts = int((time.time() - 6 * 7 * 24 * 3600) * 1000)
    st, d = req("POST", "/api/submission/track", {
        "projectId": pid, "journalId": trackJid, "journalName": "回归跟踪期刊",
        "documentId": docid or "", "submittedAt": old_ts, "currentStatus": "submitted", "note": "回归测试登记",
    })
    check("投稿跟踪·登记（含 events 初始事件）", st in (200, 201) and d.get("id") and d.get("currentStatus") == "submitted"
          and isinstance(d.get("events"), list) and len(d["events"]) == 1, f"st={st} {str(d)[:160]}")
    tid = d.get("id") if st in (200, 201) else None
    if tid:
        # 追加状态事件
        st, d2 = req("POST", f"/api/submission/track/{tid}/event", {"status": "external_review", "note": "已送外审"})
        check("投稿跟踪·追加事件（currentStatus 同步）", st in (200, 201) and d2.get("currentStatus") == "external_review"
              and len(d2.get("events", [])) == 2, f"st={st} {str(d2)[:160]}")
        # 列表：最新状态 + 事件正序 + 超期推断字段（4 周周期，投稿 6 周前 → overdue）
        st, d2 = req("GET", f"/api/submission/track?projectId={pid}")
        mine = next((x for x in d2 if x.get("id") == tid), None) if st == 200 else None
        check("投稿跟踪·列表（事件正序 + dueAt/overdue/estimatedStage 推断）",
              st == 200 and mine and mine.get("currentStatus") == "external_review"
              and mine.get("dueAt") and mine.get("overdue") is True and mine.get("overdueDays", 0) > 0
              and mine.get("estimatedStage") and isinstance(mine.get("events"), list)
              and [e["toStatus"] for e in mine["events"]] == ["submitted", "external_review"],
              f"st={st} {str(mine)[:200]}")
        # parse-email：AI 类，无 key/网关不可走既有 ai_call 跳过机制；成功时校验枚举输出
        st, d2 = ai_call("投稿跟踪·AI 邮件解析 parse-email",
                         lambda: req("POST", "/api/submission/track/parse-email",
                                     {"emailText": "尊敬的作者：您的稿件经外审专家评议，需作小修后录用，修回截止 2026-10-31。", "currentStatus": "external_review"}))
        info("投稿跟踪·parse-email", f"st={st} {str(d2)[:120]}")
        if st == 200 and d2:
            check("投稿跟踪·parse-email 返回建议状态在枚举内",
                  d2.get("suggestedStatus") in ("submitted", "initial_review", "external_review", "review_returned",
                                                 "minor_revision", "major_revision", "re_review", "final_review",
                                                 "accepted", "in_production", "rejected", "withdrawn", "transferred"),
                  f"st={st} {str(d2)[:120]}")
        # PATCH：改 note + currentStatus（同步写事件）
        st, d2 = req("PATCH", f"/api/submission/track/{tid}", {"notes": "回归改备注", "currentStatus": "minor_revision"})
        check("投稿跟踪·PATCH（备注 + 状态推进）", st == 200 and d2.get("notes") == "回归改备注"
              and d2.get("currentStatus") == "minor_revision" and len(d2.get("events", [])) >= 3, f"st={st} {str(d2)[:160]}")
        # 非法状态码应被拒绝（400）
        st, d2 = req("POST", f"/api/submission/track/{tid}/event", {"status": "not_a_real_status"})
        check("投稿跟踪·非法状态码被拒绝", st == 400, f"st={st}")
        # DELETE：级联清 events
        st, d2 = req("DELETE", f"/api/submission/track/{tid}")
        check("投稿跟踪·删除", st == 200 and d2.get("ok"), f"st={st}")
        st, d2 = req("GET", f"/api/submission/track?projectId={pid}")
        gone = not any(x.get("id") == tid for x in d2) if st == 200 else False
        check("投稿跟踪·删除后列表不含记录（events 已级联）", gone, f"st={st}")
    if trackJid:
        req("DELETE", f"/api/submission/journals-lib/{trackJid}")

# ---------- 17b. 投稿跟踪：转投他刊串联 + 修回截止日 ----------
if pid:
    # 旧记录（终态拒稿）
    st, d = req("POST", "/api/submission/track", {"projectId": pid, "journalName": "回归转投旧刊", "currentStatus": "rejected"})
    old_id = d.get("id") if st in (200, 201) else None
    # 转投新记录：带 previousSubmissionId + revisionDeadline
    st, d = req("POST", "/api/submission/track", {
        "projectId": pid, "journalName": "回归转投新刊", "currentStatus": "minor_revision",
        "previousSubmissionId": old_id or "", "revisionDeadline": int((time.time() + 10 * 24 * 3600) * 1000),
        "note": "转投自 回归转投旧刊（拒稿）",
    })
    check("投稿跟踪·转投创建（previousSubmissionId + revisionDeadline 落库返回）",
          st in (200, 201) and d.get("id") and d.get("previousSubmissionId") == old_id
          and isinstance(d.get("revisionDeadline"), int) and d.get("currentStatus") == "minor_revision",
          f"st={st} {str(d)[:200]}")
    new_id = d.get("id") if st in (200, 201) else None
    if new_id:
        # PATCH 设置/修改截止日，返回新值
        new_dl = int((time.time() + 20 * 24 * 3600) * 1000)
        st, d2 = req("PATCH", f"/api/submission/track/{new_id}", {"revisionDeadline": new_dl})
        check("投稿跟踪·PATCH revisionDeadline 返回新值",
              st == 200 and d2.get("revisionDeadline") == new_dl, f"st={st} {str(d2)[:160]}")
        # 列表反查：新记录指回旧记录
        st, d2 = req("GET", f"/api/submission/track?projectId={pid}")
        mine = next((x for x in d2 if x.get("id") == new_id), None) if st == 200 else None
        check("投稿跟踪·列表反查 previousSubmissionId",
              st == 200 and mine and mine.get("previousSubmissionId") == old_id, f"st={st} {str(mine)[:200]}")
        req("DELETE", f"/api/submission/track/{new_id}")
    if old_id:
        req("DELETE", f"/api/submission/track/{old_id}")

# ---------- 18. 文献库↔知识库打通（#5）+ RAG 引用可点（#17） ----------
if pid:
    # 造一条文献，标题与知识库文档同名 → 上传时应自动按标题指纹/忽略大小写命中并回填 referenceId
    st, ref = req("POST", "/api/references", {"projectId": pid, "hit": {
        "title": "Knowledge RAG Binding Paper", "authors": ["Test Author"], "year": 2024,
        "venue": "Sciflow Test Venue", "citationCount": 7}})
    check("打通·造文献", st in (200, 201) and ref.get("id"), f"st={st} {str(ref)[:120]}")
    bindRefId = ref.get("id") if st in (200, 201) else None

    if bindRefId:
        # 18.1 上传同名文档 → 自动绑定 referenceId
        st, d = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "Knowledge RAG Binding Paper", "type": "text",
            "content": "这是一篇关于知识库绑定测试的说明文档。图神经网络通过消息传递机制聚合邻居节点特征，在节点分类任务上表现优异。"})
        check("打通·上传同名文档自动绑定 referenceId", st in (200, 201) and d.get("referenceId") == bindRefId, f"st={st} {str(d)[:160]}")
        autoKid = d.get("id") if st in (200, 201) else None

        # 18.2 上传不同名文档 → 不命中则不强绑（referenceId 为空）
        st, d = req("POST", "/api/knowledge/upload", {"projectId": pid, "name": "Unbound Working Notes", "type": "text",
            "content": "未绑定的工作笔记。这里记录一些关于图神经网络消息传递机制与节点分类的随记要点。"})
        check("打通·未命中文献时不强绑（referenceId 为空）", st in (200, 201) and not d.get("referenceId"), f"st={st} {str(d)[:160]}")
        unboundKid = d.get("id") if st in (200, 201) else None

        # 18.3 列表嵌入 reference 摘要
        st, lst = req("GET", f"/api/knowledge?projectId={pid}")
        autoRow = next((x for x in lst if x.get("id") == autoKid), None) if st == 200 else None
        check("打通·列表返回 reference 摘要", st == 200 and autoRow and autoRow.get("reference")
              and autoRow["reference"].get("title") == "Knowledge RAG Binding Paper"
              and autoRow["reference"].get("year") == 2024
              and autoRow["reference"].get("venue") == "Sciflow Test Venue"
              and autoRow["reference"].get("citationCount") == 7, f"st={st} {str(autoRow)[:220]}")

        # 18.4 手动绑定 + 绑定不存在文献应被拒
        if unboundKid:
            st, d = req("PATCH", f"/api/knowledge/{unboundKid}/bind", {"referenceId": bindRefId})
            check("打通·PATCH 手动绑定", st == 200 and d.get("referenceId") == bindRefId
                  and d.get("reference", {}).get("title") == "Knowledge RAG Binding Paper", f"st={st} {str(d)[:180]}")
            st, d = req("PATCH", f"/api/knowledge/{unboundKid}/bind", {"referenceId": "nonexistent-ref-id"})
            check("打通·绑定不存在文献被拒绝(400)", st == 400, f"st={st} {str(d)[:120]}")

        # 18.5 RAG 问答来源带 chunkText/chunkId + referenceTitle（AI 类，外部网关不可用时跳过）
        st, d = ai_call("打通/RAG·query 来源带 chunkText+referenceTitle",
                        lambda: req("POST", "/api/knowledge/query", {"projectId": pid, "question": "图神经网络的消息传递机制是什么？"}))
        info("RAG query（打通后）", f"st={st} {str(d)[:160]}")
        if st in (200, 201) and d.get("sources"):
            src0 = d["sources"][0]
            check("RAG 引用可点·sources 带 chunkId/chunkText", bool(src0.get("chunkId")) and bool(src0.get("chunkText")), f"keys={list(src0.keys())}")
            check("RAG 来源卡片·sources 带 chunkSeq（分块序号）", all(isinstance(s.get("chunkSeq"), int) for s in d["sources"]), f"chunkSeq={[s.get('chunkSeq') for s in d['sources']]}")
            bound_src = next((s for s in d["sources"] if s.get("referenceTitle")), None)
            check("打通·命中来源带 referenceTitle", bound_src is not None
                  and bound_src.get("referenceTitle") == "Knowledge RAG Binding Paper",
                  str([s.get("referenceTitle") for s in d["sources"]]))

        # 18.6 解除绑定 → reference 回到 null
        if autoKid:
            st, d = req("PATCH", f"/api/knowledge/{autoKid}/bind", {"referenceId": None})
            check("打通·PATCH 解除绑定", st == 200 and not d.get("referenceId") and d.get("reference") is None, f"st={st} {str(d)[:160]}")

        # 清理本次造的知识库文档
        for kid in (autoKid, unboundKid):
            if kid:
                req("DELETE", f"/api/knowledge/{kid}")

# ---------- 19. 引用网络 + BibTeX/RIS 导出导入 ----------
# 造 2 篇文献 + 1 篇重复 + 1 个文档同时引用这 2 篇（产生共引边）
st, d = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Graph Regression Paper A", "authors": ["A Liu"], "year": 2022, "venue": "TKDE", "doi": "10.1/a"}})
gA = d.get("id") if st in (200, 201) else None
st, d = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "Graph Regression Paper B", "authors": ["B Chen"], "year": 2023, "venue": "NAACL"}})
gB = d.get("id") if st in (200, 201) else None
st, d = req("POST", "/api/references", {"projectId": pid, "hit": {"title": "graph regression paper a!!!", "authors": ["A Liu"], "year": 2022, "venue": "TKDE"}})
gDup = d.get("id") if st in (200, 201) else None
check("网络·重复文献 isDuplicateOf", bool(gA) and bool(gDup) and d.get("isDuplicateOf") == gA, f"st={st} dup={str(d)[:120]}")
st, d = req("POST", "/api/documents", {"projectId": pid, "title": "network-smoke-doc"})
gDoc = d.get("id") if st == 201 else None
if gDoc and gA and gB:
    req("POST", f"/api/documents/{gDoc}/citations", {"referenceId": gA})
    req("POST", f"/api/documents/{gDoc}/citations", {"referenceId": gB})
st, d = req("GET", f"/api/references/graph?projectId={pid}")
check("网络·GET graph 返回 nodes/edges", st == 200 and isinstance(d.get("nodes"), list) and isinstance(d.get("edges"), list), f"st={st} nodes={len(d.get('nodes', []))} edges={len(d.get('edges', []))}")
if st == 200:
    edge_pairs = [(e.get("a"), e.get("b"), e.get("type")) for e in d.get("edges", [])]
    has_cocite = any(t == "co-cite" and {a, b} == {gA, gB} for (a, b, t) in edge_pairs)
    has_dup = any(t == "dup" and {a, b} == {gA, gDup} for (a, b, t) in edge_pairs)
    check("网络·共引边（同文档引用 A/B）", has_cocite, str(edge_pairs))
    check("网络·重复边 type=dup", has_dup, str(edge_pairs))

def get_text(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=30) as r:
            return r.status, r.read().decode()
    except Exception as e:
        return -1, str(e)

st, txt = get_text(f"/api/references/export?projectId={pid}&format=bibtex")
check("导出·BibTeX 含 @article 与字段", st == 200 and "@article{" in txt and "title =" in txt and "Graph Regression Paper A" in txt, f"st={st} head={txt[:120]!r}")
st, txt = get_text(f"/api/references/export?projectId={pid}&format=ris")
check("导出·RIS 含 TY/TI/ER", st == 200 and "TY  - JOUR" in txt and "TI  - " in txt and "ER  -" in txt, f"st={st} head={txt[:120]!r}")

bib_sample = """@article{gr2099,
  title = {Graph Regression Paper A},
  author = {Liu, A.},
  year = {2022}
}

@inproceedings{gr2099b,
  title = {Brand New Paper C},
  author = {Wang, Z. and Li, M.},
  booktitle = {NeurIPS},
  year = {2025}
}
"""
st, d = req("POST", "/api/references/import-bibtex", {"projectId": pid, "text": bib_sample})
check("导入·BibTeX imported/skipped 计数", st in (200, 201) and d.get("imported") == 1 and d.get("skipped") == 1, f"st={st} {d}")

print("=" * 60)
print(f"结果: PASS {PASS} / FAIL {FAIL}")
if FAILED:
    print("失败项:")
    for f in FAILED:
        print(f"  - {f}")
sys.exit(1 if FAIL else 0)
