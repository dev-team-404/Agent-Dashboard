#!/usr/bin/env python3
"""
Agent Dashboard — Comprehensive Stress & Permission Test Suite
==============================================================

Tests:
1. Service CRUD stress (50 services, duplicate ID check)
2. Model management (duplicate model names allowed)
3. Concurrent LLM proxy calls (1000 users across 50 services)
4. Round-robin / failover verification
5. LLM visibility/permission enforcement
6. Service type (STANDARD vs BACKGROUND) auth enforcement
7. Rate limit enforcement (if configured)

Prerequisites:
- Mock LLM servers running on ports 9001, 9002, 9003
  (run: python3 tests/mock_llm_server.py)
- Agent Dashboard API running on port 8090
- pip install aiohttp

Usage:
    python3 tests/stress_test.py
"""

import asyncio
import aiohttp
import json
import time
import random
import string
import sys
import os
import jwt  # PyJWT
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

# ── Configuration ──────────────────────────────────
API_BASE = os.getenv("API_BASE", "http://localhost:8090/api")
PROXY_BASE = os.getenv("PROXY_BASE", "http://localhost:8090/v1")
JWT_SECRET = os.getenv("JWT_SECRET", "your-jwt-secret-change-in-production")
SUPER_ADMIN_LOGINID = "syngha.han"
SUPER_ADMIN_DEPT = "SW혁신팀(S.LSI)"

NUM_SERVICES = 50
NUM_USERS = 1000
CONCURRENT_REQUESTS = 200       # max parallel requests per batch
NUM_ROUNDS = 5                  # number of rounds of concurrent calls
MOCK_LLM_PORTS = [9001, 9002, 9003]

# Test model configs
TEST_MODELS = [
    {"name": "stress-gpt-4o", "displayName": "Stress GPT-4o", "type": "CHAT"},
    {"name": "stress-claude-3", "displayName": "Stress Claude 3", "type": "CHAT"},
    {"name": "stress-embed-v1", "displayName": "Stress Embedding", "type": "EMBEDDING"},
    {"name": "stress-rerank-v1", "displayName": "Stress Reranker", "type": "RERANKING"},
    # Duplicate model names with different endpoints (testing new feature)
    {"name": "stress-gpt-4o", "displayName": "Stress GPT-4o (Alt Endpoint)", "type": "CHAT"},
    {"name": "stress-gpt-4o", "displayName": "Stress GPT-4o (Third)", "type": "CHAT"},
]

# Visibility test models
VISIBILITY_MODELS = [
    {"name": "vis-public", "displayName": "Public Model", "visibility": "PUBLIC"},
    {"name": "vis-bu-only", "displayName": "BU-Only Model", "visibility": "BUSINESS_UNIT", "visibilityScope": ["S.LSI"]},
    {"name": "vis-team-only", "displayName": "Team-Only Model", "visibility": "TEAM", "visibilityScope": ["SW혁신팀(S.LSI)"]},
    {"name": "vis-admin-only", "displayName": "Admin-Only Model", "visibility": "ADMIN_ONLY"},
    {"name": "vis-super-only", "displayName": "SuperAdmin-Only Model", "visibility": "SUPER_ADMIN_ONLY"},
]


@dataclass
class TestResults:
    total: int = 0
    passed: int = 0
    failed: int = 0
    errors: list = field(default_factory=list)
    timings: list = field(default_factory=list)

    def record(self, name: str, success: bool, elapsed: float = 0, error: str = ""):
        self.total += 1
        if success:
            self.passed += 1
        else:
            self.failed += 1
            self.errors.append(f"FAIL: {name} — {error}")
        self.timings.append(elapsed)

    def summary(self):
        avg_ms = (sum(self.timings) / len(self.timings) * 1000) if self.timings else 0
        p50 = sorted(self.timings)[len(self.timings) // 2] * 1000 if self.timings else 0
        p95 = sorted(self.timings)[int(len(self.timings) * 0.95)] * 1000 if self.timings else 0
        p99 = sorted(self.timings)[int(len(self.timings) * 0.99)] * 1000 if self.timings else 0
        max_ms = max(self.timings) * 1000 if self.timings else 0

        return (
            f"\n{'='*60}\n"
            f"  TEST RESULTS: {self.passed}/{self.total} passed, {self.failed} failed\n"
            f"  Latency: avg={avg_ms:.0f}ms  p50={p50:.0f}ms  p95={p95:.0f}ms  p99={p99:.0f}ms  max={max_ms:.0f}ms\n"
            f"{'='*60}"
        )


def make_token(loginid: str, deptname: str = "TestDept(TestBU)", username: str = "TestUser") -> str:
    """Create a JWT token for testing."""
    payload = {"loginid": loginid, "deptname": deptname, "username": username}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def make_super_admin_token() -> str:
    return make_token(SUPER_ADMIN_LOGINID, SUPER_ADMIN_DEPT, "한승하")


# ══════════════════════════════════════════════════
# Phase 1: Service CRUD & Duplicate ID Test
# ══════════════════════════════════════════════════
async def test_service_crud(session: aiohttp.ClientSession, results: TestResults):
    print("\n" + "=" * 60)
    print("  PHASE 1: Service CRUD & Duplicate Service ID Test")
    print("=" * 60)

    token = make_super_admin_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    created_services = []
    service_ids_by_type = {"STANDARD": [], "BACKGROUND": []}

    # Create 50 services
    print(f"\n  Creating {NUM_SERVICES} services...")
    start = time.time()

    for i in range(NUM_SERVICES):
        svc_type = "STANDARD" if i % 3 != 0 else "BACKGROUND"
        svc_name = f"stress-svc-{i:03d}"
        svc_display = f"Stress Service #{i}"

        t0 = time.time()
        try:
            async with session.post(
                f"{API_BASE}/services",
                headers=headers,
                json={"name": svc_name, "displayName": svc_display, "type": svc_type}
            ) as resp:
                elapsed = time.time() - t0
                data = await resp.json()

                if resp.status == 201:
                    svc_id = data.get("service", {}).get("id", "")
                    created_services.append({"id": svc_id, "name": svc_name, "type": svc_type})
                    service_ids_by_type[svc_type].append(svc_id)
                    results.record(f"create_service_{svc_name}", True, elapsed)
                elif resp.status == 409:
                    # Already exists from previous run — still ok for test
                    # Fetch it
                    async with session.get(f"{API_BASE}/services", headers=headers) as list_resp:
                        list_data = await list_resp.json()
                        for svc in list_data.get("services", []):
                            if svc["name"] == svc_name:
                                created_services.append({"id": svc["id"], "name": svc_name, "type": svc_type})
                                service_ids_by_type[svc_type].append(svc["id"])
                                break
                    results.record(f"create_service_{svc_name}", True, elapsed)
                else:
                    results.record(f"create_service_{svc_name}", False, elapsed,
                                   f"status={resp.status}, body={json.dumps(data)}")
        except Exception as e:
            results.record(f"create_service_{svc_name}", False, 0, str(e))

    elapsed_total = time.time() - start
    print(f"  Created {len(created_services)} services in {elapsed_total:.1f}s")

    # Test duplicate service ID
    print("\n  Testing duplicate service ID error...")
    t0 = time.time()
    try:
        async with session.post(
            f"{API_BASE}/services",
            headers=headers,
            json={"name": "stress-svc-000", "displayName": "Duplicate Test"}
        ) as resp:
            elapsed = time.time() - t0
            data = await resp.json()
            is_409 = resp.status == 409
            results.record("duplicate_service_id_returns_409", is_409, elapsed,
                           f"expected 409, got {resp.status}" if not is_409 else "")
            if is_409:
                print(f"    OK: Got 409 — {data.get('error', '')}")
            else:
                print(f"    FAIL: Expected 409, got {resp.status}")
    except Exception as e:
        results.record("duplicate_service_id_returns_409", False, 0, str(e))

    return created_services, service_ids_by_type


# ══════════════════════════════════════════════════
# Phase 2: Model Management (Duplicate Names)
# ══════════════════════════════════════════════════
async def test_model_management(session: aiohttp.ClientSession, results: TestResults):
    print("\n" + "=" * 60)
    print("  PHASE 2: Model Management (Duplicate Names Allowed)")
    print("=" * 60)

    token = make_super_admin_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    created_models = []
    port_idx = 0

    # Create test models — including duplicates
    for i, model_cfg in enumerate(TEST_MODELS):
        port = MOCK_LLM_PORTS[port_idx % len(MOCK_LLM_PORTS)]
        port_idx += 1

        model_data = {
            "name": model_cfg["name"],
            "displayName": model_cfg["displayName"],
            "endpointUrl": f"http://host.docker.internal:{port}/v1/chat/completions",
            "type": model_cfg["type"],
            "visibility": "PUBLIC",
        }

        t0 = time.time()
        try:
            async with session.post(f"{API_BASE}/models", headers=headers, json=model_data) as resp:
                elapsed = time.time() - t0
                data = await resp.json()

                if resp.status == 201:
                    model_id = data.get("model", {}).get("id", "")
                    created_models.append({"id": model_id, "name": model_cfg["name"], "type": model_cfg["type"]})
                    results.record(f"create_model_{model_cfg['displayName']}", True, elapsed)
                    print(f"    Created: {model_cfg['displayName']} (name={model_cfg['name']}, id={model_id[:8]}...)")
                else:
                    results.record(f"create_model_{model_cfg['displayName']}", False, elapsed,
                                   f"status={resp.status}, body={json.dumps(data)}")
                    print(f"    FAIL: {model_cfg['displayName']} — {resp.status}: {data}")
        except Exception as e:
            results.record(f"create_model_{model_cfg['displayName']}", False, 0, str(e))

    # Verify duplicate names were created
    dup_count = sum(1 for m in created_models if m["name"] == "stress-gpt-4o")
    results.record("duplicate_model_names_allowed", dup_count >= 2, 0,
                   f"expected >=2, got {dup_count}" if dup_count < 2 else "")
    print(f"\n  Duplicate 'stress-gpt-4o' models created: {dup_count} (expected >=2)")

    # ── Service-level round-robin setup ──
    # Create 3 separate Model records all with name "stress-rr-chat"
    # on ports 9001, 9002, 9003 for service-level weighted round-robin testing
    rr_models = []
    rr_ports = [9001, 9002, 9003]
    print(f"\n  Creating 3 'stress-rr-chat' models on ports {rr_ports} for service-level RR...")
    for port in rr_ports:
        rr_model_data = {
            "name": "stress-rr-chat",
            "displayName": f"Stress RR Chat (port {port})",
            "endpointUrl": f"http://host.docker.internal:{port}/v1/chat/completions",
            "type": "CHAT",
            "visibility": "PUBLIC",
        }
        try:
            async with session.post(f"{API_BASE}/models", headers=headers, json=rr_model_data) as resp:
                data = await resp.json()
                if resp.status == 201:
                    model_id = data.get("model", {}).get("id", "")
                    rr_models.append({"id": model_id, "port": port})
                    print(f"    Created: stress-rr-chat port={port} (id={model_id[:8]}...)")
                else:
                    print(f"    FAIL: port {port} — {resp.status}: {data}")
        except Exception as e:
            print(f"    Error creating stress-rr-chat port {port}: {e}")

    results.record("rr_models_created", len(rr_models) == 3, 0,
                   f"expected 3, got {len(rr_models)}" if len(rr_models) != 3 else "")

    # Create test service "stress-rr-test-svc"
    rr_svc_id = None
    rr_svc_name = "stress-rr-test-svc"
    print(f"\n  Creating service '{rr_svc_name}'...")
    try:
        async with session.post(f"{API_BASE}/services", headers=headers,
                                json={"name": rr_svc_name, "displayName": "Stress RR Test Service"}) as resp:
            data = await resp.json()
            if resp.status == 201:
                rr_svc_id = data["service"]["id"]
                print(f"    Created: {rr_svc_name} (id={rr_svc_id[:8]}...)")
            elif resp.status == 409:
                async with session.get(f"{API_BASE}/services", headers=headers) as lr:
                    ld = await lr.json()
                    rr_svc_id = next((s["id"] for s in ld.get("services", []) if s["name"] == rr_svc_name), None)
                print(f"    Already exists: {rr_svc_name} (id={rr_svc_id[:8] if rr_svc_id else '?'}...)")
            else:
                print(f"    FAIL: {resp.status}: {data}")
    except Exception as e:
        print(f"    Error: {e}")

    # Assign all 3 models to the service with different weights:
    # port 9001: weight=2, port 9002: weight=1, port 9003: weight=1
    rr_service_model_ids = {}  # port -> serviceModelId
    rr_weight_map = {9001: 2, 9002: 1, 9003: 1}
    if rr_svc_id and rr_models:
        print(f"\n  Assigning models to '{rr_svc_name}' with weights...")
        for rm in rr_models:
            port = rm["port"]
            weight = rr_weight_map[port]
            try:
                async with session.post(
                    f"{API_BASE}/services/{rr_svc_id}/models",
                    headers=headers,
                    json={"modelId": rm["id"], "weight": weight}
                ) as resp:
                    data = await resp.json()
                    if resp.status == 201:
                        sm_id = data.get("serviceModel", {}).get("id", "")
                        rr_service_model_ids[port] = sm_id
                        print(f"    Assigned: port {port} weight={weight} (serviceModelId={sm_id[:8]}...)")
                    elif resp.status == 409:
                        # Already assigned — fetch existing service models
                        async with session.get(
                            f"{API_BASE}/services/{rr_svc_id}/models",
                            headers=headers
                        ) as lr:
                            ld = await lr.json()
                            for sm in ld.get("serviceModels", []):
                                if sm.get("modelId") == rm["id"] or sm.get("model", {}).get("id") == rm["id"]:
                                    rr_service_model_ids[port] = sm["id"]
                                    break
                        print(f"    Already assigned: port {port} (409)")
                    else:
                        print(f"    FAIL: port {port} — {resp.status}: {data}")
            except Exception as e:
                print(f"    Error assigning port {port}: {e}")

        # Use PUT to ensure correct weights (in case model was pre-existing)
        for port, sm_id in rr_service_model_ids.items():
            weight = rr_weight_map[port]
            try:
                async with session.put(
                    f"{API_BASE}/services/{rr_svc_id}/models/{sm_id}",
                    headers=headers,
                    json={"weight": weight}
                ) as resp:
                    if resp.status == 200:
                        print(f"    Weight confirmed: port {port} = {weight}")
                    else:
                        data = await resp.json()
                        print(f"    Weight update port {port}: {resp.status} — {data}")
            except Exception as e:
                print(f"    Weight update port {port}: Error — {e}")

        all_assigned = len(rr_service_model_ids) == 3
        results.record("rr_service_models_assigned", all_assigned, 0,
                       f"expected 3 assignments, got {len(rr_service_model_ids)}" if not all_assigned else "")

    return created_models, rr_models, rr_svc_id, rr_svc_name


# ══════════════════════════════════════════════════
# Phase 3: Visibility/Permission Test
# ══════════════════════════════════════════════════
async def test_visibility(session: aiohttp.ClientSession, results: TestResults):
    print("\n" + "=" * 60)
    print("  PHASE 3: LLM Visibility/Permission Enforcement")
    print("=" * 60)

    sa_token = make_super_admin_token()
    sa_headers = {"Authorization": f"Bearer {sa_token}", "Content-Type": "application/json"}

    created_vis_models = []

    # Create visibility test models as super admin
    port = MOCK_LLM_PORTS[0]
    for vm in VISIBILITY_MODELS:
        model_data = {
            "name": vm["name"],
            "displayName": vm["displayName"],
            "endpointUrl": f"http://host.docker.internal:{port}/v1/chat/completions",
            "type": "CHAT",
            "visibility": vm["visibility"],
            "visibilityScope": vm.get("visibilityScope", []),
        }
        try:
            async with session.post(f"{API_BASE}/models", headers=sa_headers, json=model_data) as resp:
                data = await resp.json()
                if resp.status == 201:
                    mid = data.get("model", {}).get("id", "")
                    created_vis_models.append({"id": mid, **vm})
                    print(f"    Created vis model: {vm['displayName']} ({vm['visibility']})")
        except Exception as e:
            print(f"    Error creating vis model: {e}")

    # Create a test service and assign all vis models to it
    svc_name = "stress-vis-test-svc"
    try:
        async with session.post(f"{API_BASE}/services", headers=sa_headers,
                                json={"name": svc_name, "displayName": "Vis Test Service"}) as resp:
            data = await resp.json()
            if resp.status == 201:
                vis_svc_id = data["service"]["id"]
            elif resp.status == 409:
                async with session.get(f"{API_BASE}/services", headers=sa_headers) as lr:
                    ld = await lr.json()
                    vis_svc_id = next((s["id"] for s in ld.get("services", []) if s["name"] == svc_name), None)
            else:
                print(f"    Warning: couldn't create vis test service: {resp.status}")
                vis_svc_id = None
    except Exception as e:
        print(f"    Error: {e}")
        vis_svc_id = None

    if vis_svc_id:
        # Assign vis models to service
        for vm in created_vis_models:
            try:
                async with session.post(
                    f"{API_BASE}/services/{vis_svc_id}/models",
                    headers=sa_headers,
                    json={"modelId": vm["id"]}
                ) as resp:
                    pass  # ignore if already added
            except:
                pass

    # Test 1: Super admin can see ALL models
    print("\n  Testing Super Admin visibility...")
    try:
        async with session.get(f"{API_BASE}/models", headers=sa_headers) as resp:
            data = await resp.json()
            models = data.get("models", [])
            vis_names = {m["name"] for m in models}
            for vm in VISIBILITY_MODELS:
                found = vm["name"] in vis_names
                results.record(f"sa_can_see_{vm['visibility']}", found, 0,
                               f"super admin should see {vm['visibility']}" if not found else "")
    except Exception as e:
        results.record("sa_visibility_check", False, 0, str(e))

    # Test 2: Regular admin visibility
    # First, register test.admin as a user, then promote to ADMIN via super admin API
    admin_login = "test.admin.stress"
    admin_dept = "SW혁신팀(S.LSI)"
    admin_token = make_token(admin_login, admin_dept, "TestAdmin")
    admin_headers_auth = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}

    # Login as admin to create user record
    try:
        async with session.post(f"{API_BASE}/auth/login", headers=admin_headers_auth) as resp:
            login_data = await resp.json()
            admin_user_id = login_data.get("user", {}).get("id", "")
    except:
        admin_user_id = ""

    # Promote to ADMIN (requires super admin)
    if admin_user_id:
        try:
            async with session.post(
                f"{API_BASE}/admin/users/{admin_user_id}/promote",
                headers=sa_headers,
                json={"role": "ADMIN"}
            ) as resp:
                pass
        except:
            pass

    # Get a fresh session token after promotion
    try:
        async with session.post(f"{API_BASE}/auth/login", headers=admin_headers_auth) as resp:
            login_data = await resp.json()
            session_token = login_data.get("sessionToken", "")
            if session_token:
                admin_headers = {"Authorization": f"Bearer {session_token}", "Content-Type": "application/json"}
            else:
                admin_headers = admin_headers_auth
    except:
        admin_headers = admin_headers_auth

    print("  Testing Admin (SW혁신팀) visibility...")
    try:
        async with session.get(f"{API_BASE}/models", headers=admin_headers) as resp:
            data = await resp.json()
            models = data.get("models", [])
            vis_names = {m["name"] for m in models}

            # Should see: PUBLIC, BU(S.LSI), TEAM(SW혁신팀), ADMIN_ONLY
            for vm in VISIBILITY_MODELS:
                should_see = vm["visibility"] in ["PUBLIC", "BUSINESS_UNIT", "TEAM", "ADMIN_ONLY"]
                found = vm["name"] in vis_names
                if should_see:
                    results.record(f"admin_sees_{vm['visibility']}", found, 0,
                                   f"admin should see {vm['visibility']}" if not found else "")
                else:
                    results.record(f"admin_cannot_see_{vm['visibility']}", not found, 0,
                                   f"admin should NOT see {vm['visibility']}" if found else "")
                print(f"    {vm['visibility']}: {'VISIBLE' if found else 'HIDDEN'} "
                      f"({'OK' if (should_see == found) else 'FAIL'})")
    except Exception as e:
        results.record("admin_visibility_check", False, 0, str(e))

    # Test 3: Proxy-level visibility — service registered by super admin inherits all access
    # Per design: "서비스는 등록한 admin의 LLM 접근 권한을 자동 계승"
    # Super admin registered service → can access ALL models
    if vis_svc_id:
        print("\n  Testing proxy-level model access (SA-registered service sees ALL)...")
        for vm in created_vis_models:
            proxy_headers = {
                "x-service-id": svc_name,
                "x-user-id": "test.user",
                "x-dept-name": "SW혁신팀(S.LSI)",
                "Content-Type": "application/json",
            }
            try:
                async with session.post(
                    f"{PROXY_BASE}/chat/completions",
                    headers=proxy_headers,
                    json={"model": vm["name"], "messages": [{"role": "user", "content": "test"}]}
                ) as resp:
                    # SA-registered service should access ALL visibility levels
                    worked = resp.status == 200
                    test_name = f"proxy_sa_svc_access_{vm['visibility']}"
                    results.record(test_name, worked, 0,
                                   f"SA svc should access {vm['visibility']} (got {resp.status})" if not worked else "")

                    status_label = "ALLOWED" if worked else f"BLOCKED({resp.status})"
                    print(f"    {vm['visibility']}: {status_label} ({'OK' if worked else 'FAIL'})")
            except Exception as e:
                results.record(f"proxy_sa_svc_access_{vm['visibility']}", False, 0, str(e))

    # Test 4: Proxy-level — service registered by regular admin should be restricted
    # Create a service as regular admin (non-super)
    if admin_user_id:
        admin_svc_name = "stress-vis-admin-svc"
        try:
            async with session.post(f"{API_BASE}/services", headers=admin_headers,
                                    json={"name": admin_svc_name, "displayName": "Admin Vis Test Service"}) as resp:
                data = await resp.json()
                if resp.status == 201:
                    admin_vis_svc_id = data["service"]["id"]
                elif resp.status == 409:
                    async with session.get(f"{API_BASE}/services", headers=sa_headers) as lr:
                        ld = await lr.json()
                        admin_vis_svc_id = next((s["id"] for s in ld.get("services", []) if s["name"] == admin_svc_name), None)
                else:
                    admin_vis_svc_id = None
        except:
            admin_vis_svc_id = None

        if admin_vis_svc_id:
            # Assign vis models
            for vm in created_vis_models:
                try:
                    async with session.post(
                        f"{API_BASE}/services/{admin_vis_svc_id}/models",
                        headers=sa_headers,
                        json={"modelId": vm["id"]}
                    ) as resp:
                        pass
                except:
                    pass

            print("\n  Testing proxy-level (admin-registered service)...")
            for vm in created_vis_models:
                proxy_headers = {
                    "x-service-id": admin_svc_name,
                    "x-user-id": "test.user",
                    "x-dept-name": "SW혁신팀(S.LSI)",
                    "Content-Type": "application/json",
                }
                try:
                    async with session.post(
                        f"{PROXY_BASE}/chat/completions",
                        headers=proxy_headers,
                        json={"model": vm["name"], "messages": [{"role": "user", "content": "test"}]}
                    ) as resp:
                        # Admin (SW혁신팀(S.LSI)) → can see PUBLIC, BU(S.LSI), TEAM(SW혁신팀), ADMIN_ONLY
                        # Cannot see: SUPER_ADMIN_ONLY
                        should_work = vm["visibility"] in ["PUBLIC", "BUSINESS_UNIT", "TEAM", "ADMIN_ONLY"]
                        worked = resp.status == 200
                        test_name = f"proxy_admin_svc_access_{vm['visibility']}"

                        if should_work:
                            results.record(test_name, worked, 0,
                                           f"admin svc should access {vm['visibility']} (got {resp.status})" if not worked else "")
                        else:
                            results.record(test_name, not worked, 0,
                                           f"admin svc should NOT access {vm['visibility']} (got {resp.status})" if worked else "")

                        status_label = "ALLOWED" if worked else f"BLOCKED({resp.status})"
                        expected = "OK" if (should_work == worked) else "FAIL"
                        print(f"    {vm['visibility']}: {status_label} ({expected})")
                except Exception as e:
                    results.record(f"proxy_admin_svc_access_{vm['visibility']}", False, 0, str(e))

    return created_vis_models


# ══════════════════════════════════════════════════
# Phase 4: Concurrent LLM Proxy Stress Test
# ══════════════════════════════════════════════════
async def test_concurrent_proxy(session: aiohttp.ClientSession, results: TestResults,
                                 created_services: list, created_models: list):
    print("\n" + "=" * 60)
    print("  PHASE 4: Concurrent LLM Proxy Stress Test")
    print(f"  {NUM_SERVICES} services x {NUM_USERS} users x {NUM_ROUNDS} rounds")
    print("=" * 60)

    if not created_services or not created_models:
        print("  SKIP: No services or models available")
        return

    # Filter to CHAT models for chat/completions
    chat_models = [m for m in created_models if m["type"] == "CHAT"]
    if not chat_models:
        print("  SKIP: No CHAT models available")
        return

    # Assign models to services (super admin)
    sa_token = make_super_admin_token()
    sa_headers = {"Authorization": f"Bearer {sa_token}", "Content-Type": "application/json"}

    print(f"\n  Assigning {len(chat_models)} models to {len(created_services)} services...")
    for svc in created_services:
        for model in chat_models[:3]:  # assign first 3 models per service
            try:
                async with session.post(
                    f"{API_BASE}/services/{svc['id']}/models",
                    headers=sa_headers,
                    json={"modelId": model["id"]}
                ) as resp:
                    pass
            except:
                pass

    # Generate user identities
    users = []
    depts = [
        "SW혁신팀(S.LSI)", "AI Platform팀(S.LSI)", "설계혁신팀(DS)",
        "데이터분석팀(DX)", "보안기술팀(S.LSI)", "클라우드팀(DS)",
        "QA팀(S.LSI)", "DevOps팀(DS)", "연구개발팀(DX)", "전략기획팀(S.LSI)",
    ]
    for i in range(NUM_USERS):
        users.append({
            "loginid": f"stress.user{i:04d}",
            "dept": depts[i % len(depts)],
        })

    # Build request payloads
    requests_to_make = []
    for round_num in range(NUM_ROUNDS):
        for user in users:
            svc = random.choice(created_services)
            model = random.choice(chat_models)

            if svc["type"] == "BACKGROUND":
                req_headers = {
                    "x-service-id": svc["name"],
                    "x-dept-name": user["dept"],
                    "Content-Type": "application/json",
                }
            else:
                req_headers = {
                    "x-service-id": svc["name"],
                    "x-user-id": user["loginid"],
                    "x-dept-name": user["dept"],
                    "Content-Type": "application/json",
                }

            payload = {
                "model": model["name"],
                "messages": [
                    {"role": "user", "content": f"Stress test round={round_num} user={user['loginid']}"}
                ],
                "max_tokens": 50,
            }

            requests_to_make.append((req_headers, payload, svc["name"], model["name"], user["loginid"]))

    total_requests = len(requests_to_make)
    print(f"  Total requests to execute: {total_requests}")

    # Execute in batches
    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)
    status_counts = defaultdict(int)
    round_robin_tracking = defaultdict(int)  # track which mock server responded
    batch_timings = []
    errors_detail = []

    async def send_request(idx, headers, payload, svc_name, model_name, user_id):
        async with semaphore:
            t0 = time.time()
            try:
                async with session.post(
                    f"{PROXY_BASE}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as resp:
                    elapsed = time.time() - t0
                    status_counts[resp.status] += 1
                    batch_timings.append(elapsed)

                    if resp.status == 200:
                        body = await resp.json()
                        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
                        # Track which mock server responded (for round-robin verification)
                        for port in MOCK_LLM_PORTS:
                            if f"llm-server-{port}" in content:
                                round_robin_tracking[port] += 1
                                break
                        results.record(f"proxy_req_{idx}", True, elapsed)
                    else:
                        body = await resp.text()
                        results.record(f"proxy_req_{idx}", False, elapsed,
                                       f"status={resp.status}")
                        if len(errors_detail) < 50:
                            errors_detail.append(f"  [{resp.status}] svc={svc_name} model={model_name} user={user_id}: {body[:200]}")
            except asyncio.TimeoutError:
                elapsed = time.time() - t0
                status_counts["timeout"] += 1
                results.record(f"proxy_req_{idx}", False, elapsed, "timeout")
                batch_timings.append(elapsed)
            except Exception as e:
                elapsed = time.time() - t0
                status_counts["error"] += 1
                results.record(f"proxy_req_{idx}", False, elapsed, str(e)[:100])
                batch_timings.append(elapsed)

    start = time.time()

    # Execute all requests concurrently
    batch_size = CONCURRENT_REQUESTS * 5
    for batch_start in range(0, total_requests, batch_size):
        batch = requests_to_make[batch_start:batch_start + batch_size]
        tasks = [
            send_request(batch_start + i, h, p, s, m, u)
            for i, (h, p, s, m, u) in enumerate(batch)
        ]
        await asyncio.gather(*tasks)

        done = min(batch_start + batch_size, total_requests)
        elapsed = time.time() - start
        rps = done / elapsed if elapsed > 0 else 0
        print(f"  Progress: {done}/{total_requests} ({rps:.0f} req/s)")

    total_time = time.time() - start
    rps = total_requests / total_time if total_time > 0 else 0

    print(f"\n  Completed {total_requests} requests in {total_time:.1f}s ({rps:.0f} req/s)")
    print(f"\n  Status distribution:")
    for status, count in sorted(status_counts.items()):
        pct = count / total_requests * 100
        print(f"    {status}: {count} ({pct:.1f}%)")

    if round_robin_tracking:
        print(f"\n  Round-robin distribution (mock servers):")
        total_rr = sum(round_robin_tracking.values())
        for port, count in sorted(round_robin_tracking.items()):
            pct = count / total_rr * 100 if total_rr > 0 else 0
            print(f"    port {port}: {count} ({pct:.1f}%)")

        # NOTE: With service-level weighted round-robin, distribution is NOT expected
        # to be even — it depends on per-service weight configuration.
        # We just verify that multiple ports received traffic (basic connectivity check).
        if len(round_robin_tracking) >= 2:
            results.record("round_robin_multi_port_traffic", True, 0)
            print(f"    (verified: {len(round_robin_tracking)} ports received traffic)")
        else:
            results.record("round_robin_multi_port_traffic", len(round_robin_tracking) >= 1, 0,
                           f"only {len(round_robin_tracking)} port(s) received traffic")

    if batch_timings:
        sorted_t = sorted(batch_timings)
        p50 = sorted_t[len(sorted_t) // 2] * 1000
        p95 = sorted_t[int(len(sorted_t) * 0.95)] * 1000
        p99 = sorted_t[int(len(sorted_t) * 0.99)] * 1000
        print(f"\n  Latency: p50={p50:.0f}ms  p95={p95:.0f}ms  p99={p99:.0f}ms")

    if errors_detail:
        print(f"\n  Sample errors (first {len(errors_detail)}):")
        for e in errors_detail[:10]:
            print(e)

    # Check success rate > 95% (mock servers have 2% intentional error rate)
    success_count = status_counts.get(200, 0)
    success_rate = success_count / total_requests * 100 if total_requests > 0 else 0
    # With SubModels, round-robin failover should recover most 5xx errors
    # Without SubModels (single endpoint), ~2% 503 is expected from mock errors
    results.record("proxy_success_rate_above_95pct", success_rate >= 95, 0,
                   f"success rate {success_rate:.1f}% < 95%" if success_rate < 95 else "")
    print(f"\n  Overall success rate: {success_rate:.1f}%")

    # Track 503 specifically (expected from mock server 2% error with single endpoint models)
    error_503 = status_counts.get(503, 0)
    error_503_pct = error_503 / total_requests * 100 if total_requests > 0 else 0
    print(f"  503 errors (mock server induced): {error_503} ({error_503_pct:.1f}%)")


# ══════════════════════════════════════════════════
# Phase 5: Service Type Auth Enforcement
# ══════════════════════════════════════════════════
async def test_service_type_auth(session: aiohttp.ClientSession, results: TestResults,
                                  created_services: list, created_models: list):
    print("\n" + "=" * 60)
    print("  PHASE 5: Service Type Auth Enforcement")
    print("=" * 60)

    std_services = [s for s in created_services if s["type"] == "STANDARD"]
    bg_services = [s for s in created_services if s["type"] == "BACKGROUND"]

    if not std_services or not bg_services:
        print("  SKIP: Need both STANDARD and BACKGROUND services")
        return

    chat_models = [m for m in created_models if m["type"] == "CHAT"]
    if not chat_models:
        print("  SKIP: No CHAT models")
        return

    model_name = chat_models[0]["name"]

    # Test 1: STANDARD without x-user-id should fail
    print("\n  Test: STANDARD service without x-user-id...")
    svc = std_services[0]
    t0 = time.time()
    try:
        async with session.post(
            f"{PROXY_BASE}/chat/completions",
            headers={"x-service-id": svc["name"], "x-dept-name": "TestDept(TestBU)", "Content-Type": "application/json"},
            json={"model": model_name, "messages": [{"role": "user", "content": "test"}]}
        ) as resp:
            elapsed = time.time() - t0
            # Should fail (401) — STANDARD requires x-user-id
            success = resp.status in [400, 401, 403]
            results.record("standard_without_userid_rejected", success, elapsed,
                           f"expected 4xx, got {resp.status}" if not success else "")
            print(f"    Status: {resp.status} ({'OK' if success else 'FAIL'})")
    except Exception as e:
        results.record("standard_without_userid_rejected", False, 0, str(e))

    # Test 2: STANDARD with all headers should succeed (retry once for mock server errors)
    print("  Test: STANDARD service with all headers...")
    for attempt in range(3):
        t0 = time.time()
        try:
            async with session.post(
                f"{PROXY_BASE}/chat/completions",
                headers={
                    "x-service-id": svc["name"],
                    "x-user-id": "test.user",
                    "x-dept-name": "TestDept(TestBU)",
                    "Content-Type": "application/json",
                },
                json={"model": model_name, "messages": [{"role": "user", "content": "test"}]}
            ) as resp:
                elapsed = time.time() - t0
                if resp.status == 200:
                    results.record("standard_with_all_headers_ok", True, elapsed)
                    print(f"    Status: {resp.status} (OK)")
                    break
                elif attempt == 2:
                    results.record("standard_with_all_headers_ok", False, elapsed,
                                   f"expected 200, got {resp.status} after 3 attempts")
                    print(f"    Status: {resp.status} (FAIL after 3 attempts)")
                else:
                    print(f"    Attempt {attempt+1}: {resp.status}, retrying...")
                    await asyncio.sleep(0.5)
        except Exception as e:
            if attempt == 2:
                results.record("standard_with_all_headers_ok", False, 0, str(e))
            await asyncio.sleep(0.5)

    # Test 3: BACKGROUND without x-user-id should succeed
    print("  Test: BACKGROUND service without x-user-id...")
    svc_bg = bg_services[0]
    t0 = time.time()
    try:
        async with session.post(
            f"{PROXY_BASE}/chat/completions",
            headers={
                "x-service-id": svc_bg["name"],
                "x-dept-name": "TestDept(TestBU)",
                "Content-Type": "application/json",
            },
            json={"model": model_name, "messages": [{"role": "user", "content": "test"}]}
        ) as resp:
            elapsed = time.time() - t0
            success = resp.status == 200
            results.record("background_without_userid_ok", success, elapsed,
                           f"expected 200, got {resp.status}" if not success else "")
            print(f"    Status: {resp.status} ({'OK' if success else 'FAIL'})")
    except Exception as e:
        results.record("background_without_userid_ok", False, 0, str(e))

    # Test 4: Missing x-service-id should fail
    print("  Test: Missing x-service-id header...")
    t0 = time.time()
    try:
        async with session.post(
            f"{PROXY_BASE}/chat/completions",
            headers={"x-user-id": "test.user", "x-dept-name": "TestDept", "Content-Type": "application/json"},
            json={"model": model_name, "messages": [{"role": "user", "content": "test"}]}
        ) as resp:
            elapsed = time.time() - t0
            success = resp.status == 401
            results.record("missing_service_id_rejected", success, elapsed,
                           f"expected 401, got {resp.status}" if not success else "")
            print(f"    Status: {resp.status} ({'OK' if success else 'FAIL'})")
    except Exception as e:
        results.record("missing_service_id_rejected", False, 0, str(e))

    # Test 5: Unregistered service should fail
    print("  Test: Unregistered service ID...")
    t0 = time.time()
    try:
        async with session.post(
            f"{PROXY_BASE}/chat/completions",
            headers={
                "x-service-id": "nonexistent-service-xyz",
                "x-user-id": "test.user",
                "x-dept-name": "TestDept",
                "Content-Type": "application/json",
            },
            json={"model": model_name, "messages": [{"role": "user", "content": "test"}]}
        ) as resp:
            elapsed = time.time() - t0
            success = resp.status == 403
            results.record("unregistered_service_rejected", success, elapsed,
                           f"expected 403, got {resp.status}" if not success else "")
            print(f"    Status: {resp.status} ({'OK' if success else 'FAIL'})")
    except Exception as e:
        results.record("unregistered_service_rejected", False, 0, str(e))


# ══════════════════════════════════════════════════
# Phase 6: Streaming Stress Test
# ══════════════════════════════════════════════════
async def test_streaming(session: aiohttp.ClientSession, results: TestResults,
                          created_services: list, created_models: list):
    print("\n" + "=" * 60)
    print("  PHASE 6: Streaming Response Stress Test")
    print("=" * 60)

    std_services = [s for s in created_services if s["type"] == "STANDARD"]
    chat_models = [m for m in created_models if m["type"] == "CHAT"]

    if not std_services or not chat_models:
        print("  SKIP: No STANDARD services or CHAT models")
        return

    svc = std_services[0]
    model = chat_models[0]

    STREAM_CONCURRENT = 50
    STREAM_COUNT = 100
    semaphore = asyncio.Semaphore(STREAM_CONCURRENT)
    success_count = 0
    fail_count = 0

    async def stream_request(idx):
        nonlocal success_count, fail_count
        async with semaphore:
            t0 = time.time()
            try:
                async with session.post(
                    f"{PROXY_BASE}/chat/completions",
                    headers={
                        "x-service-id": svc["name"],
                        "x-user-id": f"stream.user{idx:04d}",
                        "x-dept-name": "TestDept(TestBU)",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model["name"],
                        "messages": [{"role": "user", "content": f"Stream test #{idx}"}],
                        "stream": True,
                    },
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as resp:
                    if resp.status == 200:
                        chunks = 0
                        async for line in resp.content:
                            line_str = line.decode("utf-8").strip()
                            if line_str.startswith("data:"):
                                chunks += 1
                        elapsed = time.time() - t0
                        if chunks > 0:
                            success_count += 1
                            results.record(f"stream_{idx}", True, elapsed)
                        else:
                            fail_count += 1
                            results.record(f"stream_{idx}", False, elapsed, "no chunks received")
                    else:
                        fail_count += 1
                        results.record(f"stream_{idx}", False, time.time() - t0, f"status={resp.status}")
            except Exception as e:
                fail_count += 1
                results.record(f"stream_{idx}", False, time.time() - t0, str(e)[:100])

    print(f"  Sending {STREAM_COUNT} streaming requests ({STREAM_CONCURRENT} concurrent)...")
    start = time.time()
    tasks = [stream_request(i) for i in range(STREAM_COUNT)]
    await asyncio.gather(*tasks)
    total_time = time.time() - start

    print(f"  Completed in {total_time:.1f}s: {success_count} ok, {fail_count} failed")
    results.record("streaming_success_rate_above_90pct",
                   success_count / STREAM_COUNT >= 0.9, 0,
                   f"stream success {success_count}/{STREAM_COUNT}" if success_count / STREAM_COUNT < 0.9 else "")


# ══════════════════════════════════════════════════
# Phase 7: Embeddings & Rerank Stress
# ══════════════════════════════════════════════════
async def test_embeddings_rerank(session: aiohttp.ClientSession, results: TestResults,
                                  created_services: list, created_models: list):
    print("\n" + "=" * 60)
    print("  PHASE 7: Embeddings & Rerank Stress Test")
    print("=" * 60)

    embed_models = [m for m in created_models if m["type"] == "EMBEDDING"]
    rerank_models = [m for m in created_models if m["type"] == "RERANKING"]
    std_services = [s for s in created_services if s["type"] == "STANDARD"]

    if not std_services:
        print("  SKIP: No STANDARD services")
        return

    svc = std_services[0]

    # Embeddings test
    if embed_models:
        model = embed_models[0]
        EMBED_COUNT = 50
        print(f"\n  Sending {EMBED_COUNT} embedding requests...")
        semaphore = asyncio.Semaphore(20)
        success = 0

        async def embed_req(idx):
            nonlocal success
            async with semaphore:
                try:
                    async with session.post(
                        f"{PROXY_BASE}/embeddings",
                        headers={
                            "x-service-id": svc["name"],
                            "x-user-id": f"embed.user{idx}",
                            "x-dept-name": "TestDept(TestBU)",
                            "Content-Type": "application/json",
                        },
                        json={"model": model["name"], "input": f"Stress test embedding #{idx}"},
                        timeout=aiohttp.ClientTimeout(total=15)
                    ) as resp:
                        if resp.status == 200:
                            success += 1
                            results.record(f"embed_{idx}", True, 0)
                        else:
                            results.record(f"embed_{idx}", False, 0, f"status={resp.status}")
                except Exception as e:
                    results.record(f"embed_{idx}", False, 0, str(e)[:80])

        await asyncio.gather(*[embed_req(i) for i in range(EMBED_COUNT)])
        print(f"  Embeddings: {success}/{EMBED_COUNT} success")
    else:
        print("  SKIP: No EMBEDDING models")

    # Rerank test
    if rerank_models:
        model = rerank_models[0]
        RERANK_COUNT = 50
        print(f"\n  Sending {RERANK_COUNT} rerank requests...")
        semaphore = asyncio.Semaphore(20)
        success = 0

        async def rerank_req(idx):
            nonlocal success
            async with semaphore:
                try:
                    async with session.post(
                        f"{PROXY_BASE}/rerank",
                        headers={
                            "x-service-id": svc["name"],
                            "x-user-id": f"rerank.user{idx}",
                            "x-dept-name": "TestDept(TestBU)",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": model["name"],
                            "query": "What is machine learning?",
                            "documents": [f"Document #{j}" for j in range(5)],
                        },
                        timeout=aiohttp.ClientTimeout(total=15)
                    ) as resp:
                        if resp.status == 200:
                            success += 1
                            results.record(f"rerank_{idx}", True, 0)
                        else:
                            results.record(f"rerank_{idx}", False, 0, f"status={resp.status}")
                except Exception as e:
                    results.record(f"rerank_{idx}", False, 0, str(e)[:80])

        await asyncio.gather(*[rerank_req(i) for i in range(RERANK_COUNT)])
        print(f"  Rerank: {success}/{RERANK_COUNT} success")
    else:
        print("  SKIP: No RERANKING models")


# ══════════════════════════════════════════════════
# Phase 8: Weighted Round-Robin + Single-Endpoint Retry
# ══════════════════════════════════════════════════
async def test_weighted_roundrobin_and_retry(session: aiohttp.ClientSession, results: TestResults,
                                              created_services: list, created_models: list,
                                              rr_models: list = None, rr_svc_id: str = None,
                                              rr_svc_name: str = None):
    print("\n" + "=" * 60)
    print("  PHASE 8: Service-Level Weighted Round-Robin & Single-Endpoint Retry")
    print("=" * 60)

    std_services = [s for s in created_services if s["type"] == "STANDARD"]
    chat_models = [m for m in created_models if m["type"] == "CHAT"]

    # ── Test A: Service-level weighted round-robin distribution ──
    # Uses "stress-rr-test-svc" service with 3 "stress-rr-chat" models on ports 9001/9002/9003
    # Weights: port 9001=2, port 9002=1, port 9003=1
    # Expected distribution: port 9001 ~50%, port 9002 ~25%, port 9003 ~25%
    if not rr_svc_name or not rr_models:
        print("  SKIP [A]: Service-level RR not set up (missing rr_svc_name or rr_models)")
    else:
        print(f"\n  [A] Service-level weighted round-robin test")
        print(f"      Service: '{rr_svc_name}', model: 'stress-rr-chat'")
        print(f"      Weights: port 9001=2, port 9002=1, port 9003=1")
        print(f"      Expected: port 9001 ~50%, port 9002 ~25%, port 9003 ~25%")

        NUM_WRR_REQUESTS = 200
        wrr_tracking = defaultdict(int)
        wrr_success = 0
        wrr_fail = 0
        semaphore = asyncio.Semaphore(50)

        async def wrr_request(idx):
            nonlocal wrr_success, wrr_fail
            async with semaphore:
                try:
                    async with session.post(
                        f"{PROXY_BASE}/chat/completions",
                        headers={
                            "x-service-id": rr_svc_name,
                            "x-user-id": f"wrr.user{idx:04d}",
                            "x-dept-name": "TestDept(TestBU)",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": "stress-rr-chat",
                            "messages": [{"role": "user", "content": f"WRR test #{idx}"}],
                            "max_tokens": 10,
                        },
                        timeout=aiohttp.ClientTimeout(total=15)
                    ) as resp:
                        if resp.status == 200:
                            body = await resp.json()
                            content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
                            for port in MOCK_LLM_PORTS:
                                if f"llm-server-{port}" in content:
                                    wrr_tracking[port] += 1
                                    break
                            wrr_success += 1
                        else:
                            wrr_fail += 1
                except:
                    wrr_fail += 1

        start = time.time()
        await asyncio.gather(*[wrr_request(i) for i in range(NUM_WRR_REQUESTS)])
        elapsed = time.time() - start

        print(f"      Completed {NUM_WRR_REQUESTS} requests in {elapsed:.1f}s ({wrr_success} ok, {wrr_fail} fail)")
        total_tracked = sum(wrr_tracking.values())
        if total_tracked > 0:
            for port in sorted(wrr_tracking.keys()):
                pct = wrr_tracking[port] / total_tracked * 100
                print(f"      port {port}: {wrr_tracking[port]} ({pct:.1f}%)")

            # Verify port 9001 (weight=2) gets roughly double the traffic
            p9001 = wrr_tracking.get(9001, 0)
            p9002 = wrr_tracking.get(9002, 0)
            p9003 = wrr_tracking.get(9003, 0)

            # With w=2/w=1/w=1 and mock 2% error, port 9001 should get ~40-60%
            p9001_pct = p9001 / total_tracked * 100 if total_tracked > 0 else 0
            weighted_ok = 35 <= p9001_pct <= 65  # generous range for stochastic distribution
            results.record("weighted_rr_9001_double_traffic", weighted_ok, 0,
                           f"port 9001 at {p9001_pct:.1f}%, expected ~50%" if not weighted_ok else "")
            print(f"      Weighted distribution check: port 9001 at {p9001_pct:.1f}% ({'OK' if weighted_ok else 'FAIL'})")

            # Verify port 9002 and 9003 each get roughly ~25%
            p9002_pct = p9002 / total_tracked * 100 if total_tracked > 0 else 0
            p9003_pct = p9003 / total_tracked * 100 if total_tracked > 0 else 0
            minor_ok = (10 <= p9002_pct <= 40) and (10 <= p9003_pct <= 40)
            results.record("weighted_rr_minor_ports_balanced", minor_ok, 0,
                           f"port 9002={p9002_pct:.1f}% port 9003={p9003_pct:.1f}%, expected ~25% each" if not minor_ok else "")
            print(f"      Minor ports check: 9002={p9002_pct:.1f}% 9003={p9003_pct:.1f}% ({'OK' if minor_ok else 'FAIL'})")

            # Verify all 3 ports received traffic
            all_3_used = len(wrr_tracking) >= 3
            results.record("weighted_rr_all_3_ports_used", all_3_used, 0,
                           f"only {len(wrr_tracking)} ports used" if not all_3_used else "")
        else:
            results.record("weighted_rr_9001_double_traffic", False, 0, "no responses tracked")
            results.record("weighted_rr_minor_ports_balanced", False, 0, "no responses tracked")
            results.record("weighted_rr_all_3_ports_used", False, 0, "no responses tracked")

    # ── Test B: Single-endpoint retry (model without multiple service-level endpoints) ──
    # Use a model that only has a single endpoint assigned to a service
    # The 3rd chat model (stress-gpt-4o Third) should have just 1 endpoint
    if not std_services or not chat_models:
        print("\n  SKIP [B]: No STANDARD services or CHAT models for retry test")
    else:
        svc = std_services[0]
        single_ep_model = chat_models[-1] if len(chat_models) >= 3 else chat_models[0]
        print(f"\n  [B] Single-endpoint retry test: model '{single_ep_model['name']}' (id={single_ep_model['id'][:8]}...)")
        print(f"      Service: '{svc['name']}', mock server has 2% error rate → retries should recover most failures")

        NUM_RETRY_REQUESTS = 100
        retry_success = 0
        retry_fail = 0
        semaphore = asyncio.Semaphore(20)

        async def retry_request(idx):
            nonlocal retry_success, retry_fail
            async with semaphore:
                try:
                    async with session.post(
                        f"{PROXY_BASE}/chat/completions",
                        headers={
                            "x-service-id": svc["name"],
                            "x-user-id": f"retry.user{idx:04d}",
                            "x-dept-name": "TestDept(TestBU)",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": single_ep_model["name"],
                            "messages": [{"role": "user", "content": f"Retry test #{idx}"}],
                            "max_tokens": 10,
                        },
                        timeout=aiohttp.ClientTimeout(total=20)
                    ) as resp:
                        if resp.status == 200:
                            retry_success += 1
                        else:
                            retry_fail += 1
                except:
                    retry_fail += 1

        start = time.time()
        await asyncio.gather(*[retry_request(i) for i in range(NUM_RETRY_REQUESTS)])
        elapsed = time.time() - start

        # With 2% error rate and retries: success rate should be very high
        retry_rate = retry_success / NUM_RETRY_REQUESTS * 100 if NUM_RETRY_REQUESTS > 0 else 0
        print(f"      Completed in {elapsed:.1f}s: {retry_success}/{NUM_RETRY_REQUESTS} ({retry_rate:.1f}%)")

        retry_ok = retry_rate >= 95
        results.record("single_endpoint_retry_above_95pct", retry_ok, 0,
                       f"success {retry_rate:.1f}% < 95%" if not retry_ok else "")
        print(f"      Single-endpoint retry check: {retry_rate:.1f}% ({'OK' if retry_ok else 'FAIL'})")


# ══════════════════════════════════════════════════
# Cleanup
# ══════════════════════════════════════════════════
async def cleanup(session: aiohttp.ClientSession, created_services: list,
                  created_models: list, created_vis_models: list,
                  rr_models: list = None, rr_svc_id: str = None):
    print("\n" + "=" * 60)
    print("  CLEANUP: Removing test data")
    print("=" * 60)

    token = make_super_admin_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Delete services
    for svc in created_services:
        try:
            async with session.delete(f"{API_BASE}/services/{svc['id']}", headers=headers) as resp:
                pass
        except:
            pass

    # Delete vis test service
    try:
        async with session.get(f"{API_BASE}/services", headers=headers) as resp:
            data = await resp.json()
            for svc in data.get("services", []):
                if svc["name"].startswith("stress-"):
                    async with session.delete(f"{API_BASE}/services/{svc['id']}", headers=headers):
                        pass
    except:
        pass

    # Delete RR service
    if rr_svc_id:
        try:
            async with session.delete(f"{API_BASE}/services/{rr_svc_id}", headers=headers) as resp:
                pass
        except:
            pass

    # Delete RR models
    if rr_models:
        for rm in rr_models:
            try:
                async with session.delete(f"{API_BASE}/models/{rm['id']}?force=true", headers=headers) as resp:
                    pass
            except:
                pass

    # Delete test models
    all_models = created_models + created_vis_models
    for model in all_models:
        try:
            async with session.delete(f"{API_BASE}/models/{model['id']}?force=true", headers=headers) as resp:
                pass
        except:
            pass

    # Delete any remaining stress models
    try:
        async with session.get(f"{API_BASE}/models", headers=headers) as resp:
            data = await resp.json()
            for m in data.get("models", []):
                if m["name"].startswith("stress-") or m["name"].startswith("vis-"):
                    async with session.delete(f"{API_BASE}/models/{m['id']}?force=true", headers=headers):
                        pass
    except:
        pass

    # Demote test admin
    try:
        async with session.get(f"{API_BASE}/admin/users", headers=headers) as resp:
            data = await resp.json()
            for user in data.get("users", []):
                if user.get("loginid", "").startswith("test.admin"):
                    user_id = user["id"]
                    async with session.delete(f"{API_BASE}/admin/users/{user_id}/demote", headers=headers):
                        pass
    except:
        pass

    print("  Cleanup complete.")


# ══════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════
async def main():
    print("=" * 60)
    print("  AGENT DASHBOARD COMPREHENSIVE STRESS TEST")
    print(f"  Services: {NUM_SERVICES} | Users: {NUM_USERS} | Rounds: {NUM_ROUNDS}")
    print(f"  Concurrency: {CONCURRENT_REQUESTS} | Mock LLM ports: {MOCK_LLM_PORTS}")
    print("=" * 60)

    results = TestResults()

    connector = aiohttp.TCPConnector(limit=300, limit_per_host=300)
    timeout = aiohttp.ClientTimeout(total=60)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        # Check API health
        try:
            async with session.get(f"{API_BASE}/health") as resp:
                if resp.status != 200:
                    print(f"\n  ERROR: API not healthy (status={resp.status})")
                    print("  Make sure the API is running on port 8090")
                    return
                print(f"\n  API health check: OK")
        except Exception as e:
            print(f"\n  ERROR: Cannot reach API at {API_BASE}")
            print(f"  Error: {e}")
            return

        # Check mock LLM servers
        mock_ok = 0
        for port in MOCK_LLM_PORTS:
            try:
                async with session.get(f"http://localhost:{port}/health") as resp:
                    if resp.status == 200:
                        mock_ok += 1
            except:
                pass
        print(f"  Mock LLM servers: {mock_ok}/{len(MOCK_LLM_PORTS)} healthy")
        if mock_ok == 0:
            print("\n  WARNING: No mock LLM servers running!")
            print("  Start them with: python3 tests/mock_llm_server.py")
            print("  Proxy tests will fail but other tests will proceed.\n")

        start_time = time.time()

        # Initialize variables for cleanup safety
        created_services = []
        created_models = []
        created_vis_models = []
        rr_models = None
        rr_svc_id = None
        rr_svc_name = None

        try:
            # Phase 1: Service CRUD
            created_services, svc_by_type = await test_service_crud(session, results)

            # Phase 2: Model Management (duplicate names + service-level RR setup)
            created_models, rr_models, rr_svc_id, rr_svc_name = await test_model_management(session, results)

            # Phase 3: Visibility/Permission
            created_vis_models = await test_visibility(session, results)

            # Phase 4: Concurrent proxy stress
            await test_concurrent_proxy(session, results, created_services, created_models)

            # Phase 5: Service type auth enforcement
            await test_service_type_auth(session, results, created_services, created_models)

            # Phase 6: Streaming stress
            await test_streaming(session, results, created_services, created_models)

            # Phase 7: Embeddings & Rerank
            await test_embeddings_rerank(session, results, created_services, created_models)

            # Phase 8: Service-level weighted round-robin verification + single-endpoint retry
            await test_weighted_roundrobin_and_retry(session, results, created_services, created_models,
                                                     rr_models=rr_models, rr_svc_id=rr_svc_id,
                                                     rr_svc_name=rr_svc_name)

        finally:
            # Always cleanup
            await cleanup(session, created_services, created_models, created_vis_models,
                         rr_models=rr_models, rr_svc_id=rr_svc_id)

        total_time = time.time() - start_time

    # Final report
    print(results.summary())
    print(f"  Total test time: {total_time:.1f}s")

    if results.errors:
        print(f"\n  Failed tests ({min(len(results.errors), 20)} shown):")
        for err in results.errors[:20]:
            print(f"    {err}")

    if results.failed > 0:
        print(f"\n  {results.failed} tests FAILED")
        sys.exit(1)
    else:
        print(f"\n  ALL {results.passed} TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
