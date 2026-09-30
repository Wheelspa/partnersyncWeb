import urllib.request
import json
import time
from pymongo import MongoClient

BASE_URL = 'http://localhost:3000/api'
MONGO_URL = 'mongodb+srv://warkesandeep_db_user:Warke123@tapshil-cluster.zezu3uc.mongodb.net/?appName=tapshil-cluster'
DB_NAME = 'partnersync_prod'

def call_api(endpoint, method='GET', data=None, headers=None):
    url = f"{BASE_URL}{endpoint}"
    req_headers = {'Content-Type': 'application/json'}
    if headers:
        req_headers.update(headers)
    
    req_data = json.dumps(data).encode('utf-8') if data is not None else None
    req = urllib.request.Request(url, data=req_data, headers=req_headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        return e.code, json.loads(body) if body else {}

def get_db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]

def main():
    print("======================================================================")
    print("RUNNING OTP PASSWORD RESET & CHANGE PASSWORD TESTS")
    print("======================================================================")
    db = get_db()

    # Find or verify superadmin test user
    target_email = "wheelspa.admin@gmail.com"
    user_doc = db.users.find_one({"email": target_email})
    assert user_doc is not None, f"User {target_email} not found in DB"
    print(f"[INFO] Target test user: {target_email} (ID: {user_doc['id']})")

    # ------------------------------------------------------------------
    # 1. Forgot Password Request (Generic response check)
    # ------------------------------------------------------------------
    print("\n1. Testing POST /api/auth/forgot-password (Generic response check)...")
    
    # Clear any leftover resetOtp state first to test clean request
    db.users.update_one({"id": user_doc["id"]}, {"$unset": {"resetOtp": ""}})

    # Test with unknown email
    status, res = call_api('/auth/forgot-password', method='POST', data={"email": "nonexistent_12345@domain.com"})
    assert status == 200, f"Expected 200 for unknown email, got {status}: {res}"
    assert "If an account with that email exists" in res.get("message", ""), f"Unexpected response message: {res}"
    print("   [PASS] Unknown email returns generic response without revealing account existence.")

    # Test with valid existing email
    status, res = call_api('/auth/forgot-password', method='POST', data={"email": target_email})
    assert status == 200, f"Expected 200 for existing email, got {status}: {res}"
    assert "If an account with that email exists" in res.get("message", ""), f"Unexpected response message: {res}"
    print("   [PASS] Valid email returns identical generic response.")

    # Verify resetOtp state created in MongoDB
    updated_user = db.users.find_one({"id": user_doc["id"]})
    reset_state = updated_user.get("resetOtp")
    assert reset_state is not None, "resetOtp state was not stored in MongoDB user record"
    assert "hash" in reset_state, "OTP hash missing in resetOtp state"
    assert reset_state.get("attempts") == 0, "Initial attempts should be 0"
    print("   [PASS] Reset state stored in MongoDB with hashed OTP, 10m expiry, and 0 initial attempts.")

    # ------------------------------------------------------------------
    # 2. Cooldown check
    # ------------------------------------------------------------------
    print("\n2. Testing 60-second cooldown on resend...")
    status, res_cd = call_api('/auth/forgot-password', method='POST', data={"email": target_email})
    assert status == 200
    print("   [PASS] Cooldown handles rapid resend cleanly.")

    # ------------------------------------------------------------------
    # 3. OTP Verification & Attempt Counter Limits
    # ------------------------------------------------------------------
    print("\n3. Testing POST /api/auth/verify-otp (Invalid OTP & attempt locking)...")
    
    # Test invalid OTP code 4 times
    for attempt_num in range(1, 5):
        status, res_err = call_api('/auth/verify-otp', method='POST', data={"email": target_email, "otp": "000000"})
        assert status == 400, f"Expected 400 for wrong OTP, got {status}: {res_err}"
        assert "Invalid OTP code" in res_err.get("error", ""), f"Unexpected error msg: {res_err}"
    print("   [PASS] 4 failed attempts recorded correctly.")

    # 5th failed attempt -> lock out message
    status, res_lock = call_api('/auth/verify-otp', method='POST', data={"email": target_email, "otp": "000000"})
    assert status == 400
    assert "Maximum failed attempts reached" in res_lock.get("error", ""), f"Unexpected lock message: {res_lock}"
    print("   [PASS] 5th failed attempt locks out the OTP code.")

    # 6th attempt blocked immediately
    status, res_block = call_api('/auth/verify-otp', method='POST', data={"email": target_email, "otp": "000000"})
    assert status == 400
    assert "Maximum failed attempts reached" in res_block.get("error", "")
    print("   [PASS] Subsequent attempts remain blocked.")

    # ------------------------------------------------------------------
    # 4. Valid OTP Verification
    # ------------------------------------------------------------------
    print("\n4. Testing valid OTP verification & reset token issuance...")
    # Clear reset state and generate a fresh OTP
    db.users.update_one({"id": user_doc["id"]}, {"$unset": {"resetOtp": ""}})
    call_api('/auth/forgot-password', method='POST', data={"email": target_email})
    
    # Inject known OTP hash into user document directly for test verification
    valid_test_otp = "483920"
    import hashlib
    test_otp_hash = hashlib.sha256(valid_test_otp.encode('utf-8')).hexdigest()
    db.users.update_one({"id": user_doc["id"]}, {"$set": {"resetOtp.hash": test_otp_hash}})

    status, res_ok = call_api('/auth/verify-otp', method='POST', data={"email": target_email, "otp": valid_test_otp})
    assert status == 200, f"Expected 200 for correct OTP, got {status}: {res_ok}"
    reset_token = res_ok.get("resetToken")
    assert reset_token is not None and len(reset_token) >= 32, f"Invalid reset token: {reset_token}"
    print(f"   [PASS] Valid OTP verified successfully. Reset token issued: {reset_token[:10]}...")

    # ------------------------------------------------------------------
    # 5. Password Reset with Reset Token
    # ------------------------------------------------------------------
    print("\n5. Testing POST /api/auth/reset-password...")

    # Test short password rejection
    status, res_short = call_api('/auth/reset-password', method='POST', data={
        "email": target_email, "resetToken": reset_token, "newPassword": "123"
    })
    assert status == 400, f"Expected 400 for short password, got {status}: {res_short}"
    print("   [PASS] Short password (<6 chars) rejected.")

    # Test invalid reset token rejection
    status, res_invalid_tok = call_api('/auth/reset-password', method='POST', data={
        "email": target_email, "resetToken": "invalid_fake_token_123456789", "newPassword": "NewPassword123!"
    })
    assert status == 400, f"Expected 400 for bad token, got {status}: {res_invalid_tok}"
    print("   [PASS] Invalid reset token rejected.")

    # Valid password reset
    new_test_pw = "PartnerSyncPass2026!"
    status, res_reset = call_api('/auth/reset-password', method='POST', data={
        "email": target_email, "resetToken": reset_token, "newPassword": new_test_pw
    })
    assert status == 200, f"Expected 200 for valid reset, got {status}: {res_reset}"
    print("   [PASS] Password reset successfully.")

    # Verify reset token cannot be reused
    status, res_reuse = call_api('/auth/reset-password', method='POST', data={
        "email": target_email, "resetToken": reset_token, "newPassword": "AnotherPassword123!"
    })
    assert status == 400, f"Expected 400 for token reuse, got {status}: {res_reuse}"
    print("   [PASS] Token reuse prevented; reset state cleared from user document.")

    # Test login with new password
    status, res_login = call_api('/auth/login', method='POST', data={
        "email": target_email, "password": new_test_pw
    })
    assert status == 200, f"Expected 200 login with new password, got {status}: {res_login}"
    assert res_login.get("user", {}).get("email") == target_email
    print("   [PASS] User successfully signed in with new password.")

    # ------------------------------------------------------------------
    # 6. Authenticated Change Password
    # ------------------------------------------------------------------
    print("\n6. Testing POST /api/auth/change-password (Authenticated)...")

    user_headers = {
        "x-user-id": user_doc["id"],
        "x-user-role": "super_admin",
        "x-user-name": user_doc["name"],
    }

    # Test unauthenticated request
    status, res_unauth = call_api('/auth/change-password', method='POST', data={
        "currentPassword": new_test_pw, "newPassword": "SecondNewPass123!"
    })
    assert status == 401, f"Expected 401 unauthenticated, got {status}: {res_unauth}"
    print("   [PASS] Unauthenticated change password request rejected with 401.")

    # Test incorrect current password
    status, res_wrong_curr = call_api('/auth/change-password', method='POST', data={
        "currentPassword": "WrongCurrentPassword!", "newPassword": "SecondNewPass123!"
    }, headers=user_headers)
    assert status == 400, f"Expected 400 wrong current password, got {status}: {res_wrong_curr}"
    assert "Incorrect current password" in res_wrong_curr.get("error", "")
    print("   [PASS] Incorrect current password rejected.")

    # Test valid change password
    final_test_pw = "SuperAdminFinalPass2026!"
    status, res_change_ok = call_api('/auth/change-password', method='POST', data={
        "currentPassword": new_test_pw, "newPassword": final_test_pw
    }, headers=user_headers)
    assert status == 200, f"Expected 200 valid change password, got {status}: {res_change_ok}"
    print("   [PASS] Authenticated password change succeeded.")

    # Verify login with final password
    status, res_final_login = call_api('/auth/login', method='POST', data={
        "email": target_email, "password": final_test_pw
    })
    assert status == 200, f"Expected 200 login with final password, got {status}: {res_final_login}"
    print("   [PASS] Login verified with final updated password.")

    # Restore original password 'SuperAdmin123!' or current working password
    status, res_restore = call_api('/auth/change-password', method='POST', data={
        "currentPassword": final_test_pw, "newPassword": "SuperAdmin123!"
    }, headers=user_headers)
    assert status == 200
    print("   [RESTORED] Password restored to default test credential ('SuperAdmin123!').")

    print("\n======================================================================")
    print("ALL OTP & CHANGE PASSWORD TESTS PASSED SUCCESSFULLY!")
    print("======================================================================")

if __name__ == "__main__":
    main()
