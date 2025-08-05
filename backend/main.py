from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# Plaid imports
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.transactions_get_request import TransactionsGetRequest
from plaid.configuration import Configuration
from plaid.api_client import ApiClient

load_dotenv()

app = FastAPI(title="Financial AI Agent API")

# CORS middleware - must be added BEFORE routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Plaid Configuration
PLAID_ENV = os.getenv("PLAID_ENV", "production")  # Changed from "sandbox" to "production"
PLAID_HOST = "https://production.plaid.com" if PLAID_ENV == "production" else "https://sandbox.plaid.com"

configuration = Configuration(
    host=PLAID_HOST,
    api_key={
        'clientId': os.getenv("PLAID_CLIENT_ID"),
        'secret': os.getenv("PLAID_SECRET"),
    }
)

api_client = ApiClient(configuration)
plaid_client = plaid_api.PlaidApi(api_client)

# In-memory storage for demo
user_data = {
    "access_tokens": [],
    "accounts": [],
    "transactions": [],
    "insights": []
}

# Pydantic models
class LinkTokenResponse(BaseModel):
    link_token: str

class PublicTokenExchange(BaseModel):
    public_token: str

# Routes
@app.get("/health")
async def health():
    return {"status": "healthy", "environment": PLAID_ENV}

@app.post("/create_link_token", response_model=LinkTokenResponse)
async def create_link_token():
    """Create a Plaid link token"""
    try:
        user = LinkTokenCreateRequestUser(client_user_id=f"user_{datetime.now().timestamp()}")
        
        # Simplified request without account_filters
        request = LinkTokenCreateRequest(
            user=user,
            client_name="Financial AI Agent",
            products=[Products("transactions"), Products("auth")],
            country_codes=[CountryCode("US")],
            language="en"
        )
        
        response = plaid_client.link_token_create(request)
        # Access the response properly - it's an object, not a dict
        return LinkTokenResponse(link_token=response.link_token)
        
    except Exception as e:
        print(f"Error creating link token: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/exchange_public_token")
async def exchange_public_token(token_data: PublicTokenExchange):
    """Exchange public token for access token"""
    try:
        print(f"Exchanging public token: {token_data.public_token[:10]}...")
        
        request = ItemPublicTokenExchangeRequest(public_token=token_data.public_token)
        response = plaid_client.item_public_token_exchange(request)
        
        # Access the response properly and convert to string
        access_token = str(response.access_token)
        user_data["access_tokens"].append(access_token)
        
        print(f"Got access token: {access_token[:10]}...")
        
        # Fetch accounts immediately
        await fetch_accounts(access_token)
        
        print(f"Total accounts now: {len(user_data['accounts'])}")
        
        return {"success": True, "message": "Account connected successfully"}
        
    except Exception as e:
        print(f"Error exchanging token: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def fetch_accounts(access_token: str):
    """Fetch account information"""
    try:
        request = AccountsGetRequest(access_token=access_token)
        response = plaid_client.accounts_get(request)
        
        # Clear existing accounts for this access token to avoid duplicates
        user_data["accounts"] = [acc for acc in user_data["accounts"] if acc.get("access_token") != access_token]
        
        # Convert Plaid objects to plain Python dictionaries
        for account in response.accounts:
            # Get balance safely
            current_balance = 0
            if hasattr(account, 'balances') and account.balances:
                if hasattr(account.balances, 'current') and account.balances.current is not None:
                    current_balance = float(account.balances.current)
            
            account_dict = {
                "account_id": str(account.account_id),
                "name": str(account.name),
                "type": str(account.type),
                "subtype": str(account.subtype) if account.subtype else "unknown",
                "balance": current_balance,
                "access_token": access_token
            }
            user_data["accounts"].append(account_dict)
            
        print(f"Successfully fetched {len(response.accounts)} accounts")
            
    except Exception as e:
        print(f"Error fetching accounts: {e}")
        raise e  # Re-raise to see the full error

@app.get("/accounts")
async def get_accounts():
    """Get all connected accounts"""
    try:
        # Ensure all data is JSON serializable
        serializable_accounts = []
        for account in user_data["accounts"]:
            serializable_account = {
                "account_id": str(account.get("account_id", "")),
                "name": str(account.get("name", "")),
                "type": str(account.get("type", "")),
                "subtype": str(account.get("subtype", "")),
                "balance": float(account.get("balance", 0))
            }
            serializable_accounts.append(serializable_account)
        
        return {"accounts": serializable_accounts}
    except Exception as e:
        print(f"Error in get_accounts: {e}")
        return {"accounts": []}

@app.post("/fetch_transactions")
async def fetch_transactions():
    """Fetch transactions from all connected accounts"""
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=30)  # Last 30 days
    
    # Clear existing transactions to avoid duplicates
    user_data["transactions"] = []
    
    for access_token in user_data["access_tokens"]:
        try:
            request = TransactionsGetRequest(
                access_token=access_token,
                start_date=start_date,
                end_date=end_date
            )
            response = plaid_client.transactions_get(request)
            
            # Convert Plaid objects to plain Python dictionaries
            for transaction in response.transactions:
                # Safely extract category
                category_list = []
                if hasattr(transaction, 'category') and transaction.category:
                    category_list = [str(cat) for cat in transaction.category]
                
                # Safely extract merchant name
                merchant_name = None
                if hasattr(transaction, 'merchant_name') and transaction.merchant_name:
                    merchant_name = str(transaction.merchant_name)
                
                transaction_dict = {
                    "transaction_id": str(transaction.transaction_id),
                    "account_id": str(transaction.account_id),
                    "amount": float(transaction.amount),
                    "date": str(transaction.date),
                    "name": str(transaction.name),
                    "category": category_list,
                    "merchant_name": merchant_name,
                }
                user_data["transactions"].append(transaction_dict)
                
        except Exception as e:
            print(f"Error fetching transactions: {e}")
    
    print(f"Successfully fetched {len(user_data['transactions'])} transactions")
    return {"message": "Transactions fetched successfully", "count": len(user_data["transactions"])}

@app.get("/dashboard")
async def get_dashboard():
    """Get complete dashboard data"""
    try:
        # Ensure all data is JSON serializable
        serializable_accounts = []
        for account in user_data["accounts"]:
            serializable_account = {
                "account_id": str(account.get("account_id", "")),
                "name": str(account.get("name", "")),
                "type": str(account.get("type", "")),
                "subtype": str(account.get("subtype", "")),
                "balance": float(account.get("balance", 0))
            }
            serializable_accounts.append(serializable_account)
        
        serializable_transactions = []
        for transaction in user_data["transactions"][-20:]:  # Last 20 transactions
            serializable_transaction = {
                "transaction_id": str(transaction.get("transaction_id", "")),
                "account_id": str(transaction.get("account_id", "")),
                "amount": float(transaction.get("amount", 0)),
                "date": str(transaction.get("date", "")),
                "name": str(transaction.get("name", "")),
                "category": transaction.get("category", []),
                "merchant_name": transaction.get("merchant_name")
            }
            serializable_transactions.append(serializable_transaction)
        
        serializable_insights = user_data["insights"][-5:] if user_data["insights"] else []  # Last 5 insights
        
        return {
            "accounts": serializable_accounts,
            "recent_transactions": serializable_transactions,
            "recent_insights": serializable_insights,
        }
    except Exception as e:
        print(f"Error in get_dashboard: {e}")
        return {
            "accounts": [],
            "recent_transactions": [],
            "recent_insights": [],
        }

@app.post("/generate_insights")
async def generate_insights():
    """Generate basic financial insights"""
    try:
        # Calculate basic metrics
        total_spending = sum(t['amount'] for t in user_data["transactions"] if t['amount'] > 0)
        total_balance = sum(a['balance'] for a in user_data["accounts"])
        
        # Group spending by category
        spending_by_category = {}
        for transaction in user_data["transactions"]:
            if transaction['amount'] > 0 and transaction['category']:
                category = transaction['category'][0]
                spending_by_category[category] = spending_by_category.get(category, 0) + transaction['amount']
        
        # Generate basic insights
        insights = {
            "total_spending": total_spending,
            "total_balance": total_balance,
            "spending_by_category": spending_by_category,
            "top_categories": sorted(spending_by_category.items(), key=lambda x: x[1], reverse=True)[:5],
            "recommendations": [
                "Track your spending in top categories",
                "Set up automatic savings transfers",
                "Review monthly subscriptions",
                "Consider high-yield savings account"
            ],
            "generated_at": datetime.now().isoformat()
        }
        
        user_data["insights"].append(insights)
        return {"insights": insights}
        
    except Exception as e:
        print(f"Error generating insights: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)