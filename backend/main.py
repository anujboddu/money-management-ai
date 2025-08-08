from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
import os
import json
import re
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
from plaid.model.institutions_get_request import InstitutionsGetRequest
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
PLAID_ENV = os.getenv("PLAID_ENV", "sandbox")

# Set the correct Plaid host based on environment
# For newer versions of plaid-python, use string URLs directly
if PLAID_ENV == "production":
    PLAID_HOST = "https://production.plaid.com"
elif PLAID_ENV == "development": 
    PLAID_HOST = "https://development.plaid.com"
else:
    PLAID_HOST = "https://sandbox.plaid.com"

configuration = Configuration(
    host=PLAID_HOST,
    api_key={
        'clientId': os.getenv("PLAID_CLIENT_ID"),
        'secret': os.getenv("PLAID_SECRET"),
    }
)

api_client = ApiClient(configuration)
plaid_client = plaid_api.PlaidApi(api_client)

# Data persistence functions
DATA_FILE = "user_data.json"

def load_user_data():
    """Load user data from file"""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            print("Error loading user data, starting fresh")
    return {
        "access_tokens": [],
        "accounts": [],
        "transactions": [],
        "insights": []
    }

def save_user_data():
    """Save user data to file"""
    try:
        with open(DATA_FILE, 'w') as f:
            json.dump(user_data, f, indent=2)
    except IOError as e:
        print(f"Error saving user data: {e}")

# Load existing data on startup
user_data = load_user_data()

# Early Payment Detection Functions
def configure_early_payments():
    """
    Return configuration for your specific early payments.
    You can customize this based on your needs.
    """
    return {
        "mortgage": {
            "amount": 3416.03,
            "keywords": ["mortgage", "loan", "mtg", "home loan", "wells fargo home", "quicken"],
            "days_early": 2,
            "tolerance": 10.00  # Allow $10 difference
        },
        # Add other recurring early payments here
        # "car_payment": {
        #     "amount": 450.00,
        #     "keywords": ["auto loan", "car payment"],
        #     "days_early": 3,
        #     "tolerance": 5.00
        # }
    }

def is_early_payment(transaction, config):
    """
    Check if a transaction matches the criteria for an early payment.
    """
    # Check amount (within tolerance)
    amount_match = abs(transaction['amount'] - config['amount']) <= config.get('tolerance', 0)
    
    # Check if transaction name contains any of the keywords
    name_lower = transaction['name'].lower()
    keyword_match = any(keyword in name_lower for keyword in config['keywords'])
    
    # Check if it's near the end of the month (likely early payment for next month)
    transaction_date = datetime.strptime(transaction['date'], '%Y-%m-%d')
    days_in_month = (datetime(transaction_date.year, transaction_date.month % 12 + 1, 1) - timedelta(days=1)).day
    is_end_of_month = transaction_date.day >= (days_in_month - config['days_early'])
    
    return amount_match and keyword_match and is_end_of_month

def detect_early_payments(transactions, known_payments=None):
    """
    Detect and adjust early payments to their intended month.
    
    Args:
        transactions: List of transaction dictionaries
        known_payments: Dict of known early payments with patterns and amounts
    """
    if known_payments is None:
        known_payments = configure_early_payments()
    
    adjusted_transactions = []
    adjustment_count = 0
    
    for transaction in transactions:
        adjusted_transaction = transaction.copy()
        
        # Check if this transaction matches any known early payment pattern
        for payment_type, config in known_payments.items():
            if is_early_payment(transaction, config):
                # Adjust the date to the intended month
                original_date = datetime.strptime(transaction['date'], '%Y-%m-%d')
                adjusted_date = original_date + timedelta(days=config['days_early'])
                adjusted_transaction['date'] = adjusted_date.strftime('%Y-%m-%d')
                adjusted_transaction['original_date'] = transaction['date']
                adjusted_transaction['payment_type'] = payment_type
                adjusted_transaction['date_adjusted'] = True
                adjustment_count += 1
                print(f"Adjusted {payment_type} payment from {transaction['date']} to {adjusted_transaction['date']}")
                break
        
        adjusted_transactions.append(adjusted_transaction)
    
    if adjustment_count > 0:
        print(f"Total adjustments made: {adjustment_count}")
    
    return adjusted_transactions

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
        save_user_data()  # Save after adding access token
        
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
        save_user_data()  # Save after fetching accounts
            
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
    start_date = end_date - timedelta(days=90)  # Extended to 90 days for more data
    
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
            
            # Handle pagination for more than 100 transactions
            total_transactions = response.total_transactions
            transactions_fetched = len(response.transactions)
            
            # Process initial batch
            for transaction in response.transactions:
                category_list = []
                if hasattr(transaction, 'category') and transaction.category:
                    category_list = [str(cat) for cat in transaction.category]
                
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
            
            # Fetch remaining transactions if there are more
            while transactions_fetched < total_transactions:
                request = TransactionsGetRequest(
                    access_token=access_token,
                    start_date=start_date,
                    end_date=end_date,
                    offset=transactions_fetched
                )
                response = plaid_client.transactions_get(request)
                
                for transaction in response.transactions:
                    category_list = []
                    if hasattr(transaction, 'category') and transaction.category:
                        category_list = [str(cat) for cat in transaction.category]
                    
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
                
                transactions_fetched += len(response.transactions)
                
        except Exception as e:
            print(f"Error fetching transactions: {e}")
    
    # Sort transactions by date (newest first)
    user_data["transactions"].sort(key=lambda x: x["date"], reverse=True)
    save_user_data()  # Save after fetching transactions
    
    print(f"Successfully fetched {len(user_data['transactions'])} transactions")
    return {"message": "Transactions fetched successfully", "count": len(user_data["transactions"])}

@app.get("/dashboard")
async def get_dashboard():
    """Get complete dashboard data with early payment adjustments applied"""
    try:
        # Apply early payment adjustments to transactions
        adjusted_transactions = detect_early_payments(user_data["transactions"])
        
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
        for transaction in adjusted_transactions[-20:]:  # Last 20 transactions
            serializable_transaction = {
                "transaction_id": str(transaction.get("transaction_id", "")),
                "account_id": str(transaction.get("account_id", "")),
                "amount": float(transaction.get("amount", 0)),
                "date": str(transaction.get("date", "")),
                "name": str(transaction.get("name", "")),
                "category": transaction.get("category", []),
                "merchant_name": transaction.get("merchant_name"),
                "original_date": transaction.get("original_date"),
                "date_adjusted": transaction.get("date_adjusted", False),
                "payment_type": transaction.get("payment_type")
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

@app.get("/transactions_adjusted")
async def get_transactions_adjusted():
    """Get all transactions with early payment adjustments applied"""
    try:
        adjusted_transactions = detect_early_payments(user_data["transactions"])
        
        serializable_transactions = []
        for transaction in adjusted_transactions:
            serializable_transaction = {
                "transaction_id": str(transaction.get("transaction_id", "")),
                "account_id": str(transaction.get("account_id", "")),
                "amount": float(transaction.get("amount", 0)),
                "date": str(transaction.get("date", "")),
                "name": str(transaction.get("name", "")),
                "category": transaction.get("category", []),
                "merchant_name": transaction.get("merchant_name"),
                "original_date": transaction.get("original_date"),
                "date_adjusted": transaction.get("date_adjusted", False),
                "payment_type": transaction.get("payment_type")
            }
            serializable_transactions.append(serializable_transaction)
        
        return {"transactions": serializable_transactions}
    except Exception as e:
        print(f"Error in get_transactions_adjusted: {e}")
        return {"transactions": []}

@app.post("/generate_insights")
async def generate_insights():
    """Generate advanced financial insights with early payment adjustments"""
    try:
        if not user_data["transactions"]:
            return {"error": "No transactions available. Please fetch transactions first."}
        
        # Apply early payment adjustments
        adjusted_transactions = detect_early_payments(user_data["transactions"])
        
        # Calculate basic metrics using adjusted transactions
        total_spending = sum(t['amount'] for t in adjusted_transactions if t['amount'] > 0)
        total_income = sum(abs(t['amount']) for t in adjusted_transactions if t['amount'] < 0)
        net_cashflow = total_income - total_spending
        total_balance = sum(a['balance'] for a in user_data["accounts"])
        
        # Group spending by category
        spending_by_category = {}
        monthly_spending = {}
        merchant_spending = {}
        
        for transaction in adjusted_transactions:
            if transaction['amount'] > 0:  # Only spending (positive amounts)
                # Category analysis
                if transaction['category']:
                    category = transaction['category'][0]
                    spending_by_category[category] = spending_by_category.get(category, 0) + transaction['amount']
                
                # Monthly analysis (using adjusted dates)
                month = transaction['date'][:7]  # YYYY-MM format
                monthly_spending[month] = monthly_spending.get(month, 0) + transaction['amount']
                
                # Merchant analysis
                if transaction['merchant_name']:
                    merchant = transaction['merchant_name']
                    merchant_spending[merchant] = merchant_spending.get(merchant, 0) + transaction['amount']
        
        # Calculate savings rate
        savings_rate = (net_cashflow / total_income * 100) if total_income > 0 else 0
        
        # Top spending analysis
        top_categories = sorted(spending_by_category.items(), key=lambda x: x[1], reverse=True)[:5]
        top_merchants = sorted(merchant_spending.items(), key=lambda x: x[1], reverse=True)[:5]
        
        # Monthly trend analysis
        sorted_months = sorted(monthly_spending.items())
        monthly_trend = "increasing" if len(sorted_months) >= 2 and sorted_months[-1][1] > sorted_months[-2][1] else "decreasing"
        
        # Count adjusted transactions
        adjusted_count = len([t for t in adjusted_transactions if t.get('date_adjusted')])
        
        # Generate smart recommendations
        recommendations = []
        
        if adjusted_count > 0:
            recommendations.append(f"Adjusted {adjusted_count} early payment(s) to their intended months for accurate analysis.")
        
        if savings_rate < 20:
            recommendations.append(f"Your savings rate is {savings_rate:.1f}%. Consider aiming for 20% or higher.")
        
        if top_categories:
            top_category = top_categories[0]
            recommendations.append(f"You spent ${top_category[1]:.2f} on {top_category[0]}. Review if this aligns with your priorities.")
        
        if len([t for t in adjusted_transactions if "subscription" in t['name'].lower() or "monthly" in t['name'].lower()]) > 0:
            recommendations.append("Review your subscriptions - you may have recurring charges to optimize.")
        
        if monthly_trend == "increasing":
            recommendations.append("Your spending has increased this month. Consider reviewing your budget.")
        
        recommendations.append("Set up automated savings transfers to reach your financial goals faster.")
        
        # Generate insights
        insights = {
            "total_spending": round(total_spending, 2),
            "total_income": round(total_income, 2),
            "net_cashflow": round(net_cashflow, 2),
            "savings_rate": round(savings_rate, 1),
            "total_balance": round(total_balance, 2),
            "spending_by_category": {k: round(v, 2) for k, v in spending_by_category.items()},
            "top_categories": [(cat, round(amt, 2)) for cat, amt in top_categories],
            "top_merchants": [(merchant, round(amt, 2)) for merchant, amt in top_merchants],
            "monthly_spending": {k: round(v, 2) for k, v in monthly_spending.items()},
            "monthly_trend": monthly_trend,
            "recommendations": recommendations,
            "transaction_count": len(user_data["transactions"]),
            "adjusted_transactions_count": adjusted_count,
            "analysis_period": f"{len(set(t['date'][:7] for t in adjusted_transactions))} months",
            "generated_at": datetime.now().isoformat()
        }
        
        user_data["insights"].append(insights)
        save_user_data()  # Save after generating insights
        return {"insights": insights}
        
    except Exception as e:
        print(f"Error generating insights: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/available_institutions")
async def get_available_institutions():
    """Get list of available institutions"""
    try:
        request = InstitutionsGetRequest(
            count=50,
            offset=0,
            country_codes=[CountryCode("US")]
        )
        response = plaid_client.institutions_get(request)
        institutions = []
        for institution in response.institutions:
            institutions.append({
                "institution_id": str(institution.institution_id),
                "name": str(institution.name),
                "products": [str(product) for product in institution.products] if institution.products else []
            })
        return {"institutions": institutions}
    except Exception as e:
        print(f"Error fetching institutions: {e}")
        return {"institutions": []}

@app.post("/refresh_data")
async def refresh_data():
    """Refresh both accounts and transactions data"""
    try:
        # Refresh accounts
        for access_token in user_data["access_tokens"]:
            await fetch_accounts(access_token)
        # Refresh transactions
        await fetch_transactions()
        save_user_data()  # Save after refreshing
        return {
            "success": True,
            "message": "Data refreshed successfully",
            "accounts_count": len(user_data["accounts"]),
            "transactions_count": len(user_data["transactions"])
        }
    except Exception as e:
        print(f"Error refreshing data: {e}")
        return {
            "success": False,
            "message": str(e),
            "accounts_count": len(user_data["accounts"]),
            "transactions_count": len(user_data["transactions"])
        }

@app.post("/clear_data")
async def clear_data():
    """Clear all stored data"""
    try:
        global user_data
        user_data = {
            "access_tokens": [],
            "accounts": [],
            "transactions": [],
            "insights": []
        }
        save_user_data()
        return {"success": True, "message": "All data cleared successfully"}
    except Exception as e:
        print(f"Error clearing data: {e}")
        return {"success": False, "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)