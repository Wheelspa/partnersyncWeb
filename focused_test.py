#!/usr/bin/env python3
"""
Focused test to verify specific issues
"""
import requests
import json

BASE_URL = "https://4fedafc4-3255-47d3-9b85-92c485741025.preview.emergentagent.com/api"
HEADERS = {
    "Content-Type": "application/json",
    "x-user-id": "test-user-001",
    "x-user-name": "Rajesh Kumar",
    "x-user-role": "partner"
}

print("="*80)
print("FOCUSED TEST: _id leak and audit trail")
print("="*80)

# Test 1: Create transaction and check for _id leak
print("\n1. Creating transaction...")
payload = {
    "type": "expense",
    "category": "Testing",
    "amount": 25000,
    "mode": "bank",
    "description": "Focused test transaction"
}
resp = requests.post(f"{BASE_URL}/transactions", headers=HEADERS, json=payload, timeout=10)
print(f"Status: {resp.status_code}")
tx = resp.json()
print(f"Response keys: {list(tx.keys())}")
if '_id' in tx:
    print(f"❌ CRITICAL: _id field leaked in response: {tx['_id']}")
else:
    print(f"✅ No _id leak")
tx_id = tx.get('id')
print(f"Transaction ID: {tx_id}")

# Test 2: Check audit log was created
print("\n2. Checking audit trail for CREATE action...")
resp = requests.get(f"{BASE_URL}/audit", headers=HEADERS, timeout=10)
logs = resp.json()
print(f"Total audit logs: {len(logs)}")
create_logs = [l for l in logs if l['action'] == 'CREATE' and l['entity'] == 'transaction' and l['entityId'] == tx_id]
if create_logs:
    print(f"✅ Audit log found for transaction creation")
    print(f"   Action: {create_logs[0]['action']}, User: {create_logs[0]['userName']}")
else:
    print(f"❌ No audit log found for transaction creation")

# Test 3: Approve the transaction
print(f"\n3. Approving transaction {tx_id}...")
resp = requests.post(f"{BASE_URL}/transactions/{tx_id}/approve", headers=HEADERS, json={"comment": "Approved"}, timeout=10)
print(f"Status: {resp.status_code}")
if resp.status_code == 200:
    approved_tx = resp.json()
    print(f"Status: {approved_tx.get('status')}")
    print(f"Approved by: {approved_tx.get('approvedByName')}")
    if approved_tx.get('status') == 'approved':
        print(f"✅ Transaction approved successfully")
    else:
        print(f"❌ Transaction not approved")
else:
    print(f"❌ Approve failed")

# Test 4: Check audit log for APPROVE
print("\n4. Checking audit trail for APPROVE action...")
resp = requests.get(f"{BASE_URL}/audit", headers=HEADERS, timeout=10)
logs = resp.json()
approve_logs = [l for l in logs if l['action'] == 'APPROVE' and l['entity'] == 'transaction' and l['entityId'] == tx_id]
if approve_logs:
    print(f"✅ Audit log found for transaction approval")
else:
    print(f"❌ No audit log found for transaction approval")

# Test 5: Add comment
print(f"\n5. Adding comment to transaction {tx_id}...")
resp = requests.post(f"{BASE_URL}/transactions/{tx_id}/comment", headers=HEADERS, json={"text": "Need invoice copy"}, timeout=10)
print(f"Status: {resp.status_code}")
if resp.status_code == 200:
    comment = resp.json()
    print(f"Comment ID: {comment.get('id')}")
    print(f"Comment text: {comment.get('text')}")
    print(f"✅ Comment added")
else:
    print(f"❌ Comment failed")

# Test 6: Verify comment in transaction
print(f"\n6. Verifying comment appears in transaction...")
resp = requests.get(f"{BASE_URL}/transactions", headers=HEADERS, timeout=10)
txs = resp.json()
target = next((t for t in txs if t['id'] == tx_id), None)
if target and len(target.get('comments', [])) > 0:
    print(f"✅ Comment found in transaction: {target['comments'][0]['text']}")
else:
    print(f"❌ Comment not found in transaction")

# Test 7: Check audit log for COMMENT
print("\n7. Checking audit trail for COMMENT action...")
resp = requests.get(f"{BASE_URL}/audit", headers=HEADERS, timeout=10)
logs = resp.json()
comment_logs = [l for l in logs if l['action'] == 'COMMENT' and l['entity'] == 'transaction' and l['entityId'] == tx_id]
if comment_logs:
    print(f"✅ Audit log found for comment")
else:
    print(f"❌ No audit log found for comment")

# Test 8: Create budget and check _id
print("\n8. Creating budget...")
payload = {
    "name": "Test Budget",
    "type": "operational",
    "amount": 50000,
    "period": "Q3-2026"
}
resp = requests.post(f"{BASE_URL}/budgets", headers=HEADERS, json=payload, timeout=10)
budget = resp.json()
print(f"Response keys: {list(budget.keys())}")
if '_id' in budget:
    print(f"❌ CRITICAL: _id field leaked in budget response: {budget['_id']}")
else:
    print(f"✅ No _id leak in budget")

# Test 9: Create quotation and check _id
print("\n9. Creating quotation...")
payload = {
    "title": "Test Quote",
    "vendorName": "Test Vendor",
    "amount": 75000
}
resp = requests.post(f"{BASE_URL}/quotations", headers=HEADERS, json=payload, timeout=10)
quote = resp.json()
print(f"Response keys: {list(quote.keys())}")
if '_id' in quote:
    print(f"❌ CRITICAL: _id field leaked in quotation response: {quote['_id']}")
else:
    print(f"✅ No _id leak in quotation")

print("\n" + "="*80)
print("FOCUSED TEST COMPLETE")
print("="*80)
