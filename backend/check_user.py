from app.db.database import SessionLocal
from app.models.user import User
from app.core.auth import get_password_hash

db = SessionLocal()

# Check existing users
users = db.query(User).all()
print(f"Total users: {len(users)}")

if len(users) == 0:
    print("\nNo users found. Creating test user...")
    test_user = User(
        username="admin",
        hashed_password=get_password_hash("12345"),
        full_name="Admin User"
    )
    db.add(test_user)
    db.commit()
    print("✅ Created user: admin / 12345")
else:
    print("\nExisting users:")
    for user in users:
        print(f"  - {user.username}")

db.close()
