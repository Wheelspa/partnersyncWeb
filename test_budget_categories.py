#!/usr/bin/env python3
import requests
import json
import sys

BASE_URL = "http://localhost:3000/api"

ADMIN_HEADERS = {
    "Content-Type": "application/json",
    "x-user-id": "admin-user-001",
    "x-user-name": "System Admin",
    "x-user-role": "super_admin"
}

PARTNER_HEADERS = {
    "Content-Type": "application/json",
    "x-user-id": "partner-user-001",
    "x-user-name": "Aarav Mehta",
    "x-user-role": "partner"
}

def test_budget_categories():
    print("=" * 70)
    print("RUNNING BUDGET CATEGORIES MANAGEMENT TESTS")
    print("=" * 70)

    # 1. GET budget categories
    print("\n1. Testing GET /api/budget-categories...")
    resp = requests.get(f"{BASE_URL}/budget-categories", headers=PARTNER_HEADERS, timeout=10)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    cats = resp.json()
    print(f"[OK] Received {len(cats)} categories:")
    for c in cats:
        print(f"   - {c['name']} (slug: {c['slug']})")
    
    cat_names = [c['name'] for c in cats]
    for required in ["Annual", "Marketing", "Operational", "Capital Expenditure", "Project", "Partner Capital", "Loan"]:
        assert required in cat_names, f"Missing required category: {required}"
    print("[OK] All 7 initial categories (5 existing + 2 requested) present!")

    # 2. POST budget category as Partner (Forbidden test)
    print("\n2. Testing POST /api/budget-categories as Partner (Role Restriction)...")
    payload = {"name": "Unapproved Category"}
    resp = requests.post(f"{BASE_URL}/budget-categories", headers=PARTNER_HEADERS, json=payload, timeout=10)
    print(f"   Status Code: {resp.status_code}, Response: {resp.text}")
    assert resp.status_code == 403, f"Expected 403 Forbidden for partner, got {resp.status_code}"
    print("[OK] Partner access correctly rejected with 403 Forbidden!")

    # 3. POST budget category as Admin (Create test)
    print("\n3. Testing POST /api/budget-categories as Super Admin...")
    payload = {"name": "R&D Operations"}
    resp = requests.post(f"{BASE_URL}/budget-categories", headers=ADMIN_HEADERS, json=payload, timeout=10)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    new_cat = resp.json()
    new_cat_id = new_cat['id']
    print(f"[OK] Category created: {new_cat['name']} (id: {new_cat_id}, slug: {new_cat['slug']})")

    # 4. PATCH budget category as Partner (Forbidden test)
    print("\n4. Testing PATCH /api/budget-categories as Partner (Role Restriction)...")
    payload = {"name": "Hack Category"}
    resp = requests.patch(f"{BASE_URL}/budget-categories/{new_cat_id}", headers=PARTNER_HEADERS, json=payload, timeout=10)
    assert resp.status_code == 403, f"Expected 403 Forbidden for partner edit, got {resp.status_code}"
    print("[OK] Partner edit correctly rejected with 403 Forbidden!")

    # 5. PATCH budget category as Admin (Rename test)
    print("\n5. Testing PATCH /api/budget-categories as Super Admin (Rename)...")
    payload = {"name": "Research & Development"}
    resp = requests.patch(f"{BASE_URL}/budget-categories/{new_cat_id}", headers=ADMIN_HEADERS, json=payload, timeout=10)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    updated_cat = resp.json()
    assert updated_cat['name'] == "Research & Development"
    print(f"[OK] Category successfully renamed to: {updated_cat['name']}")

    # 6. Create Budget with new category slug
    print("\n6. Creating budget using the new category slug...")
    b_payload = {
        "name": "Q4 AI Research Budget",
        "type": updated_cat['slug'],
        "amount": 1500000,
        "period": "2026-Q4"
    }
    resp = requests.post(f"{BASE_URL}/budgets", headers=ADMIN_HEADERS, json=b_payload, timeout=10)
    assert resp.status_code == 200, f"Expected 200 creating budget, got {resp.status_code}: {resp.text}"
    b_doc = resp.json()
    assert b_doc['type'] == updated_cat['slug']
    print(f"[OK] Budget created successfully with category '{b_doc['type']}': ID={b_doc['id']}")

    # 7. Check Audit Trail
    print("\n7. Verifying Audit Trail for budget_category actions...")
    resp = requests.get(f"{BASE_URL}/audit", headers=ADMIN_HEADERS, timeout=10)
    assert resp.status_code == 200
    logs = resp.json()
    cat_logs = [l for l in logs if l.get('entity') == 'budget_category']
    print(f"[OK] Found {len(cat_logs)} audit log entries for budget_category:")
    for l in cat_logs:
        print(f"   - Action: {l['action']}, User: {l['userName']} ({l['userRole']}), Reason: {l.get('reason')}")
    assert len(cat_logs) >= 2, "Expected at least 2 audit entries (CREATE and UPDATE)"

    print("\n" + "=" * 70)
    print("ALL TESTS PASSED SUCCESSFULLY!")
    print("=" * 70)

if __name__ == "__main__":
    test_budget_categories()
