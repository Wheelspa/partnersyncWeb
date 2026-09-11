#!/usr/bin/env python3
"""
PartnerSync Backend API Test Suite
Tests all endpoints with focus on audit trail integrity and UUID usage
"""
import requests
import json
import sys
from typing import Dict, Any

# Base URL from .env
BASE_URL = "https://4fedafc4-3255-47d3-9b85-92c485741025.preview.emergentagent.com/api"

# Test user headers
HEADERS = {
    "Content-Type": "application/json",
    "x-user-id": "test-user-001",
    "x-user-name": "Rajesh Kumar",
    "x-user-role": "partner"
}

def print_test(name: str):
    print(f"\n{'='*80}")
    print(f"TEST: {name}")
    print('='*80)

def print_pass(msg: str):
    print(f"✅ PASS: {msg}")

def print_fail(msg: str):
    print(f"❌ FAIL: {msg}")

def print_response(resp):
    print(f"Status: {resp.status_code}")
    try:
        data = resp.json()
        print(f"Response: {json.dumps(data, indent=2)[:500]}")
    except:
        print(f"Response: {resp.text[:500]}")

def test_health():
    print_test("Health Check")
    try:
        resp = requests.get(f"{BASE_URL}/health", timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get('status') == 'ok' and data.get('app') == 'PartnerSync':
                print_pass("Health endpoint returns correct response")
                return True
            else:
                print_fail(f"Health response incorrect: {data}")
                return False
        else:
            print_fail(f"Health check failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Health check exception: {e}")
        return False

def test_users():
    print_test("Users Listing")
    try:
        resp = requests.get(f"{BASE_URL}/users", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            users = resp.json()
            if isinstance(users, list) and len(users) == 4:
                names = [u.get('name') for u in users]
                expected = ['Aarav Mehta', 'Priya Sharma', 'Rohan Iyer', 'Neha Kapoor']
                if all(name in names for name in expected):
                    # Check for UUID and no _id
                    if all('id' in u and '_id' not in u for u in users):
                        print_pass("Users endpoint returns 4 seeded users with UUIDs, no _id")
                        return True
                    else:
                        print_fail("Users missing 'id' or contain '_id'")
                        return False
                else:
                    print_fail(f"Expected users not found. Got: {names}")
                    return False
            else:
                print_fail(f"Expected 4 users, got {len(users) if isinstance(users, list) else 'non-list'}")
                return False
        else:
            print_fail(f"Users endpoint failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Users test exception: {e}")
        return False

def test_dashboard():
    print_test("Dashboard KPIs")
    try:
        resp = requests.get(f"{BASE_URL}/dashboard", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            data = resp.json()
            required_keys = ['kpis', 'series', 'pieData', 'recent']
            if all(k in data for k in required_keys):
                kpis = data['kpis']
                kpi_fields = ['totalBudget', 'budgetUsed', 'pendingApprovals', 'income', 'expense', 
                             'profit', 'cashFlow', 'bankBalance', 'outstandingReceivables', 
                             'upcomingPayments', 'quotationsSubmitted', 'quotationsApproved', 
                             'quotationsRejected', 'partnerContributions']
                if all(f in kpis for f in kpi_fields):
                    if len(data['series']) == 6:
                        if isinstance(data['pieData'], list) and isinstance(data['recent'], list):
                            print_pass("Dashboard returns all required KPIs, 6-month series, pieData, and recent")
                            return True
                        else:
                            print_fail("pieData or recent not arrays")
                            return False
                    else:
                        print_fail(f"Expected 6 series entries, got {len(data['series'])}")
                        return False
                else:
                    missing = [f for f in kpi_fields if f not in kpis]
                    print_fail(f"Missing KPI fields: {missing}")
                    return False
            else:
                missing = [k for k in required_keys if k not in data]
                print_fail(f"Missing dashboard keys: {missing}")
                return False
        else:
            print_fail(f"Dashboard failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Dashboard test exception: {e}")
        return False

def test_transactions_list():
    print_test("Transactions List")
    try:
        resp = requests.get(f"{BASE_URL}/transactions", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            txs = resp.json()
            if isinstance(txs, list) and len(txs) >= 10:
                # Check first transaction has all required fields
                tx = txs[0]
                required = ['id', 'type', 'category', 'amount', 'gst', 'mode', 'status', 
                           'description', 'invoiceNumber', 'createdByName', 'createdAt', 'comments']
                if all(f in tx for f in required):
                    if '_id' not in tx:
                        print_pass(f"Transactions list returns {len(txs)} transactions with all required fields, no _id")
                        return True
                    else:
                        print_fail("Transaction contains _id field")
                        return False
                else:
                    missing = [f for f in required if f not in tx]
                    print_fail(f"Transaction missing fields: {missing}")
                    return False
            else:
                print_fail(f"Expected at least 10 transactions, got {len(txs) if isinstance(txs, list) else 'non-list'}")
                return False
        else:
            print_fail(f"Transactions list failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Transactions list exception: {e}")
        return False

def test_transaction_create():
    print_test("Create Transaction")
    try:
        payload = {
            "type": "expense",
            "category": "Office Supplies",
            "amount": 15000,
            "mode": "bank",
            "description": "Testing transaction creation"
        }
        resp = requests.post(f"{BASE_URL}/transactions", headers=HEADERS, json=payload, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            tx = resp.json()
            if tx.get('status') == 'pending' and 'id' in tx:
                # Check GST is auto-computed (~18%)
                expected_gst = round(15000 * 0.18)
                if abs(tx.get('gst', 0) - expected_gst) < 100:
                    if '_id' not in tx:
                        print_pass(f"Transaction created with status=pending, UUID id, GST={tx.get('gst')}")
                        return tx['id']  # Return ID for further tests
                    else:
                        print_fail("Created transaction contains _id")
                        return None
                else:
                    print_fail(f"GST incorrect: expected ~{expected_gst}, got {tx.get('gst')}")
                    return None
            else:
                print_fail(f"Transaction not created properly: {tx}")
                return None
        else:
            print_fail(f"Create transaction failed with status {resp.status_code}")
            return None
    except Exception as e:
        print_fail(f"Create transaction exception: {e}")
        return None

def test_transaction_approve(tx_id: str):
    print_test("Approve Transaction")
    try:
        payload = {"comment": "Approved for testing"}
        resp = requests.post(f"{BASE_URL}/transactions/{tx_id}/approve", headers=HEADERS, json=payload, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            tx = resp.json()
            if tx.get('status') == 'approved' and tx.get('approvedByName'):
                print_pass(f"Transaction approved, status=approved, approvedByName={tx.get('approvedByName')}")
                return True
            else:
                print_fail(f"Transaction not approved properly: {tx}")
                return False
        else:
            print_fail(f"Approve transaction failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Approve transaction exception: {e}")
        return False

def test_transaction_comment(tx_id: str):
    print_test("Add Transaction Comment")
    try:
        payload = {"text": "Need clarification on this expense"}
        resp = requests.post(f"{BASE_URL}/transactions/{tx_id}/comment", headers=HEADERS, json=payload, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            comment = resp.json()
            if comment.get('text') == payload['text'] and 'id' in comment:
                print_pass(f"Comment added with UUID id")
                # Verify comment appears in transaction
                tx_resp = requests.get(f"{BASE_URL}/transactions", headers=HEADERS, timeout=10)
                if tx_resp.status_code == 200:
                    txs = tx_resp.json()
                    target_tx = next((t for t in txs if t['id'] == tx_id), None)
                    if target_tx and len(target_tx.get('comments', [])) > 0:
                        print_pass("Comment appears in transaction's comments array")
                        return True
                    else:
                        print_fail("Comment not found in transaction")
                        return False
                else:
                    print_fail("Could not verify comment in transaction list")
                    return False
            else:
                print_fail(f"Comment not created properly: {comment}")
                return False
        else:
            print_fail(f"Add comment failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Add comment exception: {e}")
        return False

def test_budgets_list():
    print_test("Budgets List")
    try:
        resp = requests.get(f"{BASE_URL}/budgets", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            budgets = resp.json()
            if isinstance(budgets, list) and len(budgets) == 4:
                budget = budgets[0]
                required = ['amount', 'utilized', 'status', 'type', 'period']
                if all(f in budget for f in required):
                    if '_id' not in budget and 'id' in budget:
                        print_pass("Budgets list returns 4 budgets with all required fields, UUID id, no _id")
                        return True
                    else:
                        print_fail("Budget missing 'id' or contains '_id'")
                        return False
                else:
                    missing = [f for f in required if f not in budget]
                    print_fail(f"Budget missing fields: {missing}")
                    return False
            else:
                print_fail(f"Expected 4 budgets, got {len(budgets) if isinstance(budgets, list) else 'non-list'}")
                return False
        else:
            print_fail(f"Budgets list failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Budgets list exception: {e}")
        return False

def test_budget_create():
    print_test("Create Budget")
    try:
        payload = {
            "name": "Test Marketing Budget",
            "type": "marketing",
            "amount": 100000,
            "period": "Q4-2025"
        }
        resp = requests.post(f"{BASE_URL}/budgets", headers=HEADERS, json=payload, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            budget = resp.json()
            if budget.get('status') == 'pending' and 'id' in budget:
                print_pass(f"Budget created with status=pending, UUID id")
                return budget['id']
            else:
                print_fail(f"Budget not created properly: {budget}")
                return None
        else:
            print_fail(f"Create budget failed with status {resp.status_code}")
            return None
    except Exception as e:
        print_fail(f"Create budget exception: {e}")
        return None

def test_budget_approve(budget_id: str):
    print_test("Approve Budget")
    try:
        payload = {"comment": "Budget approved"}
        resp = requests.post(f"{BASE_URL}/budgets/{budget_id}/approve", headers=HEADERS, json=payload, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            budget = resp.json()
            if budget.get('status') == 'approved':
                print_pass("Budget approved, status=approved")
                return True
            else:
                print_fail(f"Budget not approved properly: {budget}")
                return False
        else:
            print_fail(f"Approve budget failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Approve budget exception: {e}")
        return False

def test_quotations_list():
    print_test("Quotations List")
    try:
        resp = requests.get(f"{BASE_URL}/quotations", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            quotes = resp.json()
            if isinstance(quotes, list) and len(quotes) == 4:
                if all('id' in q and '_id' not in q for q in quotes):
                    print_pass("Quotations list returns 4 quotations with UUID id, no _id")
                    return True
                else:
                    print_fail("Quotation missing 'id' or contains '_id'")
                    return False
            else:
                print_fail(f"Expected 4 quotations, got {len(quotes) if isinstance(quotes, list) else 'non-list'}")
                return False
        else:
            print_fail(f"Quotations list failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Quotations list exception: {e}")
        return False

def test_quotation_create():
    print_test("Create Quotation")
    try:
        payload = {
            "title": "Test Software License",
            "vendorName": "TechCorp India",
            "amount": 50000
        }
        resp = requests.post(f"{BASE_URL}/quotations", headers=HEADERS, json=payload, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            quote = resp.json()
            if quote.get('status') == 'submitted' and 'id' in quote:
                print_pass(f"Quotation created with status=submitted, UUID id")
                return quote['id']
            else:
                print_fail(f"Quotation not created properly: {quote}")
                return None
        else:
            print_fail(f"Create quotation failed with status {resp.status_code}")
            return None
    except Exception as e:
        print_fail(f"Create quotation exception: {e}")
        return None

def test_quotation_workflow(quote_id: str):
    print_test("Quotation Workflow (review -> approve)")
    try:
        # Review
        resp = requests.post(f"{BASE_URL}/quotations/{quote_id}/review", headers=HEADERS, json={}, timeout=10)
        print(f"Review response: {resp.status_code}")
        if resp.status_code == 200:
            quote = resp.json()
            if quote.get('status') == 'under_review':
                print_pass("Quotation status changed to under_review")
            else:
                print_fail(f"Review failed: {quote}")
                return False
        else:
            print_fail(f"Review failed with status {resp.status_code}")
            return False
        
        # Approve
        resp = requests.post(f"{BASE_URL}/quotations/{quote_id}/approve", headers=HEADERS, json={}, timeout=10)
        print(f"Approve response: {resp.status_code}")
        if resp.status_code == 200:
            quote = resp.json()
            if quote.get('status') == 'approved':
                print_pass("Quotation status changed to approved")
                return True
            else:
                print_fail(f"Approve failed: {quote}")
                return False
        else:
            print_fail(f"Approve failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Quotation workflow exception: {e}")
        return False

def test_vendors():
    print_test("Vendors List")
    try:
        resp = requests.get(f"{BASE_URL}/vendors", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            vendors = resp.json()
            if isinstance(vendors, list) and len(vendors) == 4:
                if all('id' in v and '_id' not in v for v in vendors):
                    print_pass("Vendors list returns 4 vendors with UUID id, no _id")
                    return True
                else:
                    print_fail("Vendor missing 'id' or contains '_id'")
                    return False
            else:
                print_fail(f"Expected 4 vendors, got {len(vendors) if isinstance(vendors, list) else 'non-list'}")
                return False
        else:
            print_fail(f"Vendors list failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Vendors list exception: {e}")
        return False

def test_ledger():
    print_test("Partner Ledger")
    try:
        resp = requests.get(f"{BASE_URL}/ledger", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            data = resp.json()
            if 'partners' in data and 'totalProfit' in data:
                partners = data['partners']
                if isinstance(partners, list) and len(partners) > 0:
                    partner = partners[0]
                    required = ['capital', 'share', 'additionalInvestment', 'profitShare', 'outstandingBalance']
                    if all(f in partner for f in required):
                        print_pass(f"Ledger returns {len(partners)} partners with all required fields, totalProfit={data['totalProfit']}")
                        return True
                    else:
                        missing = [f for f in required if f not in partner]
                        print_fail(f"Partner missing fields: {missing}")
                        return False
                else:
                    print_fail("No partners in ledger")
                    return False
            else:
                print_fail("Ledger missing 'partners' or 'totalProfit'")
                return False
        else:
            print_fail(f"Ledger failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Ledger test exception: {e}")
        return False

def test_audit_trail():
    print_test("Audit Trail")
    try:
        resp = requests.get(f"{BASE_URL}/audit", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            logs = resp.json()
            if isinstance(logs, list) and len(logs) > 0:
                log = logs[0]
                required = ['action', 'entity', 'entityId', 'userId', 'userName', 'userRole', 'createdAt']
                if all(f in log for f in required):
                    if '_id' not in log and 'id' in log:
                        print_pass(f"Audit trail returns {len(logs)} entries with all required fields, UUID id, no _id")
                        return True
                    else:
                        print_fail("Audit log missing 'id' or contains '_id'")
                        return False
                else:
                    missing = [f for f in required if f not in log]
                    print_fail(f"Audit log missing fields: {missing}")
                    return False
            else:
                print_fail("No audit logs found")
                return False
        else:
            print_fail(f"Audit trail failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Audit trail exception: {e}")
        return False

def test_notifications():
    print_test("Notifications Feed")
    try:
        resp = requests.get(f"{BASE_URL}/notifications", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            notifs = resp.json()
            if isinstance(notifs, list) and len(notifs) > 0:
                notif = notifs[0]
                required = ['title', 'message', 'createdAt', 'icon']
                if all(f in notif for f in required):
                    print_pass(f"Notifications returns {len(notifs)} notifications with all required fields")
                    return True
                else:
                    missing = [f for f in required if f not in notif]
                    print_fail(f"Notification missing fields: {missing}")
                    return False
            else:
                print_fail("No notifications found")
                return False
        else:
            print_fail(f"Notifications failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Notifications exception: {e}")
        return False

def test_error_handling():
    print_test("Error Handling - Non-existent Path")
    try:
        resp = requests.get(f"{BASE_URL}/nonexistent", headers=HEADERS, timeout=10)
        print_response(resp)
        
        if resp.status_code == 404:
            data = resp.json()
            if 'error' in data:
                print_pass("Non-existent path returns 404 with error message")
                return True
            else:
                print_fail("404 response missing error field")
                return False
        else:
            print_fail(f"Expected 404, got {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Error handling exception: {e}")
        return False

def test_error_handling_invalid_id():
    print_test("Error Handling - Non-existent Transaction ID")
    try:
        resp = requests.post(f"{BASE_URL}/transactions/does-not-exist/approve", headers=HEADERS, json={}, timeout=10)
        print_response(resp)
        
        if resp.status_code == 404:
            data = resp.json()
            if 'error' in data:
                print_pass("Non-existent transaction ID returns 404 with error message")
                return True
            else:
                print_fail("404 response missing error field")
                return False
        else:
            print_fail(f"Expected 404, got {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Error handling exception: {e}")
        return False

def test_reset():
    print_test("Reset Endpoint")
    try:
        resp = requests.post(f"{BASE_URL}/reset", headers=HEADERS, json={}, timeout=10)
        print_response(resp)
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get('reset') == True:
                # Verify data is fresh
                users_resp = requests.get(f"{BASE_URL}/users", headers=HEADERS, timeout=10)
                if users_resp.status_code == 200:
                    users = users_resp.json()
                    if len(users) == 4:
                        print_pass("Reset successful, data re-seeded")
                        return True
                    else:
                        print_fail("Reset did not re-seed data properly")
                        return False
                else:
                    print_fail("Could not verify reset")
                    return False
            else:
                print_fail(f"Reset response incorrect: {data}")
                return False
        else:
            print_fail(f"Reset failed with status {resp.status_code}")
            return False
    except Exception as e:
        print_fail(f"Reset exception: {e}")
        return False

def main():
    print("\n" + "="*80)
    print("PARTNERSYNC BACKEND API TEST SUITE")
    print("="*80)
    
    results = {}
    
    # Basic endpoints
    results['health'] = test_health()
    results['users'] = test_users()
    results['dashboard'] = test_dashboard()
    results['vendors'] = test_vendors()
    results['ledger'] = test_ledger()
    
    # Transactions flow
    results['transactions_list'] = test_transactions_list()
    tx_id = test_transaction_create()
    if tx_id:
        results['transaction_create'] = True
        results['transaction_approve'] = test_transaction_approve(tx_id)
        results['transaction_comment'] = test_transaction_comment(tx_id)
    else:
        results['transaction_create'] = False
        results['transaction_approve'] = False
        results['transaction_comment'] = False
    
    # Budgets flow
    results['budgets_list'] = test_budgets_list()
    budget_id = test_budget_create()
    if budget_id:
        results['budget_create'] = True
        results['budget_approve'] = test_budget_approve(budget_id)
    else:
        results['budget_create'] = False
        results['budget_approve'] = False
    
    # Quotations flow
    results['quotations_list'] = test_quotations_list()
    quote_id = test_quotation_create()
    if quote_id:
        results['quotation_create'] = True
        results['quotation_workflow'] = test_quotation_workflow(quote_id)
    else:
        results['quotation_create'] = False
        results['quotation_workflow'] = False
    
    # Audit and notifications
    results['audit_trail'] = test_audit_trail()
    results['notifications'] = test_notifications()
    
    # Error handling
    results['error_404'] = test_error_handling()
    results['error_invalid_id'] = test_error_handling_invalid_id()
    
    # Reset (last test)
    results['reset'] = test_reset()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
