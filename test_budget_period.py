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

def test_budget_period():
    print("=" * 70)
    print("RUNNING BUDGET PERIOD (MONTH + YEAR) TESTS")
    print("=" * 70)

    # 1. Create a new budget with Month and Year
    print("\n1. Creating budget with Month='March' and Year=2026...")
    payload = {
        "name": "Q1 Machinery Expansion Budget",
        "type": "capex",
        "amount": 2500000,
        "periodMonth": "March",
        "periodYear": 2026,
        "period": "March 2026"
    }
    resp = requests.post(f"{BASE_URL}/budgets", headers=ADMIN_HEADERS, json=payload, timeout=10)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    b_doc = resp.json()
    print(f"[OK] Budget created successfully:")
    print(f"     ID: {b_doc['id']}")
    print(f"     Name: {b_doc['name']}")
    print(f"     Period: {b_doc['period']}")
    print(f"     Period Month: {b_doc.get('periodMonth')}")
    print(f"     Period Year: {b_doc.get('periodYear')}")

    assert b_doc['periodMonth'] == "March", f"Expected 'March', got {b_doc.get('periodMonth')}"
    assert b_doc['periodYear'] == 2026, f"Expected 2026, got {b_doc.get('periodYear')}"
    assert b_doc['period'] == "March 2026", f"Expected 'March 2026', got {b_doc.get('period')}"

    # 2. GET all budgets and verify legacy + new budgets exist cleanly
    print("\n2. Fetching all budgets to verify structure & backward compatibility...")
    resp = requests.get(f"{BASE_URL}/budgets", headers=PARTNER_HEADERS, timeout=10)
    assert resp.status_code == 200
    budgets = resp.json()
    print(f"[OK] Fetched {len(budgets)} budgets total.")
    
    # Check for legacy and new formats
    periods = [b['period'] for b in budgets]
    print(f"     Found budget periods in database: {periods[:6]}")
    assert "March 2026" in periods, "New Month+Year budget period not found"
    
    # 3. Filter budgets by month and year query parameters
    print("\n3. Testing GET /api/budgets with month & year filter parameters...")
    resp = requests.get(f"{BASE_URL}/budgets?month=March&year=2026", headers=PARTNER_HEADERS, timeout=10)
    assert resp.status_code == 200
    filtered_budgets = resp.json()
    print(f"[OK] Filtered query returned {len(filtered_budgets)} budgets matching March 2026:")
    for fb in filtered_budgets:
        print(f"   - {fb['name']} ({fb['period']})")
    assert any(fb['id'] == b_doc['id'] for fb in filtered_budgets), "Newly created budget not found in filtered query"

    print("\n" + "=" * 70)
    print("ALL BUDGET PERIOD TESTS PASSED SUCCESSFULLY!")
    print("=" * 70)

if __name__ == "__main__":
    test_budget_period()
