import urllib.request
import json

BASE_URL = 'http://localhost:3000/api'

def call_api(endpoint, method='GET', data=None, role='super_admin', email='superadmin@partnersync.com'):
    url = f"{BASE_URL}{endpoint}"
    headers = {
        'Content-Type': 'application/json',
        'x-user-role': role,
        'x-user-id': 'usr_super',
        'x-user-email': email
    }
    
    req_data = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        return e.code, json.loads(body) if body else {}

def main():
    print("Testing Budget Priority Feature...")

    # 1. Create budget with explicit High priority
    high_budget = {
        "name": "High Priority AI Compute",
        "type": "operational",
        "priority": "high",
        "amount": 500000,
        "periodMonth": "October",
        "periodYear": 2026,
        "period": "October 2026"
    }
    status, res = call_api('/budgets', method='POST', data=high_budget)
    print(f"Create High Priority Budget status: {status}")
    assert status in [200, 201], f"Expected 200/201, got {status}: {res}"
    assert res.get("priority") == "high", f"Expected priority 'high', got '{res.get('priority')}'"
    print("PASS: High priority budget created with priority='high'")

    # 2. Create budget without priority (should default to medium)
    def_budget = {
        "name": "Default Priority Marketing",
        "type": "marketing",
        "amount": 100000,
        "periodMonth": "November",
        "periodYear": 2026,
        "period": "November 2026"
    }
    status2, res2 = call_api('/budgets', method='POST', data=def_budget)
    print(f"Create Default Budget status: {status2}")
    assert status2 in [200, 201], f"Expected 200/201, got {status2}: {res2}"
    assert res2.get("priority") == "medium", f"Expected priority 'medium', got '{res2.get('priority')}'"
    print("PASS: Default budget created with priority='medium'")

    # 3. Verify GET /budgets contains priority field for created budgets
    status3, items = call_api('/budgets', method='GET')
    print(f"GET /budgets status: {status3}, total items: {len(items)}")
    found_high = next((b for b in items if b.get("id") == res.get("id")), None)
    found_def = next((b for b in items if b.get("id") == res2.get("id")), None)
    
    assert found_high is not None and found_high.get("priority") == "high", "GET /budgets high priority mismatch"
    assert found_def is not None and found_def.get("priority") == "medium", "GET /budgets default priority mismatch"
    print("PASS: GET /budgets verified successfully with correct priority fields.")

    print("\nALL PRIORITY TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    main()
