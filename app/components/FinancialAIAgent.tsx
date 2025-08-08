'use client';

import React, { useState, useEffect } from 'react';

const FinancialAIAgent = () => {
    const [linkToken, setLinkToken] = useState(null);
    const [status, setStatus] = useState("");
    const [accounts, setAccounts] = useState([]);
    const [insights, setInsights] = useState(null);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');
    const [transactions, setTransactions] = useState([]);

    const API_BASE = "http://localhost:8000";

    // Early Payment Configuration
    const earlyPaymentConfig = {
        mortgage: {
            amount: 3416.03,
            keywords: ['mortgage', 'loan', 'mtg', 'home loan', 'wells fargo home', 'quicken'],
            daysEarly: 2,
            tolerance: 10.00
        }
        // Add other early payments here if needed
    };

    // Load initial data on component mount
    useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        try {
            // Check backend status
            const healthResponse = await fetch(`${API_BASE}/health`);
            const healthData = await healthResponse.json();
            setStatus(healthData.status);

            // Load dashboard data (includes accounts and recent transactions with adjustments)
            const dashboardResponse = await fetch(`${API_BASE}/dashboard`);
            const dashboardData = await dashboardResponse.json();
            
            if (dashboardData.accounts && dashboardData.accounts.length > 0) {
                setAccounts(dashboardData.accounts);
                setTransactions(dashboardData.recent_transactions || []);
                console.log(`Loaded ${dashboardData.accounts.length} existing accounts`);
                console.log(`Loaded ${dashboardData.recent_transactions.length} recent transactions`);
            }
        } catch (error) {
            console.error('Error loading initial data:', error);
            setStatus("offline");
        }
    };

    // Create link token
    const createLinkToken = async () => {
        try {
            const response = await fetch(`${API_BASE}/create_link_token`, {
                method: 'POST',
            });
            const data = await response.json();
            setLinkToken(data.link_token);
        } catch (error) {
            console.error('Error creating link token:', error);
        }
    };

    // Initialize Plaid Link manually
    const initializePlaidLink = () => {
        if (typeof window !== 'undefined' && window.Plaid && linkToken) {
            const handler = window.Plaid.create({
                token: linkToken,
                onSuccess: async (public_token, metadata) => {
                    console.log('Plaid Link Success:', metadata);

                    try {
                        // Exchange public token
                        await fetch(`${API_BASE}/exchange_public_token`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ public_token })
                        });

                        // Fetch transactions
                        await fetchTransactions();

                        // Load updated dashboard data
                        await loadDashboard();

                    } catch (error) {
                        console.error('Error exchanging token:', error);
                    }
                },
                onExit: (err, metadata) => {
                    if (err) console.error('Plaid Link Error:', err);
                },
            });

            handler.open();
        }
    };

    // Load Plaid script
    useEffect(() => {
        if (!document.querySelector('script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]')) {
            const script = document.createElement('script');
            script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
            script.async = true;
            document.head.appendChild(script);
        }
    }, []);

    const loadAccounts = async () => {
        try {
            const response = await fetch(`${API_BASE}/accounts`);
            const data = await response.json();
            setAccounts(data.accounts);
        } catch (error) {
            console.error('Error loading accounts:', error);
        }
    };

    const fetchTransactions = async () => {
        try {
            setLoading(true);
            await fetch(`${API_BASE}/fetch_transactions`, { method: 'POST' });

            // Wait a bit for background processing
            setTimeout(loadDashboard, 3000);
        } catch (error) {
            console.error('Error fetching transactions:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadDashboard = async () => {
        try {
            const response = await fetch(`${API_BASE}/dashboard`);
            const data = await response.json();
            setAccounts(data.accounts);
            setTransactions(data.recent_transactions);
        } catch (error) {
            console.error('Error loading dashboard:', error);
        }
    };

    const loadAllTransactions = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE}/transactions_adjusted`);
            const data = await response.json();
            setTransactions(data.transactions);
            console.log(`Loaded ${data.transactions.length} transactions with adjustments`);
        } catch (error) {
            console.error('Error loading all transactions:', error);
        } finally {
            setLoading(false);
        }
    };

    const refreshData = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE}/refresh_data`, { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                await loadDashboard();
                console.log('Data refreshed successfully');
            }
        } catch (error) {
            console.error('Error refreshing data:', error);
        } finally {
            setLoading(false);
        }
    };

    const generateInsights = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE}/generate_insights`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ time_period: '30_days' })
            });
            const data = await response.json();
            setInsights(data.insights);
        } catch (error) {
            console.error('Error generating insights:', error);
        } finally {
            setLoading(false);
        }
    };

    // Function to detect if a transaction is an early payment
    const isEarlyPayment = (transaction, config) => {
        const amountMatch = Math.abs(transaction.amount - config.amount) <= config.tolerance;
        const nameMatch = config.keywords.some(keyword => 
            transaction.name.toLowerCase().includes(keyword)
        );
        
        const transactionDate = new Date(transaction.date);
        const lastDayOfMonth = new Date(transactionDate.getFullYear(), transactionDate.getMonth() + 1, 0);
        const isEndOfMonth = transactionDate.getDate() >= (lastDayOfMonth.getDate() - config.daysEarly);
        
        return amountMatch && nameMatch && isEndOfMonth;
    };

    // Function to adjust early payments
    const adjustEarlyPayments = (transactions) => {
        return transactions.map(transaction => {
            const adjustedTransaction = { ...transaction };
            
            for (const [paymentType, config] of Object.entries(earlyPaymentConfig)) {
                if (isEarlyPayment(transaction, config)) {
                    const originalDate = new Date(transaction.date);
                    const adjustedDate = new Date(originalDate);
                    adjustedDate.setDate(adjustedDate.getDate() + config.daysEarly);
                    
                    adjustedTransaction.date = adjustedDate.toISOString().split('T')[0];
                    adjustedTransaction.originalDate = transaction.date;
                    adjustedTransaction.paymentType = paymentType;
                    adjustedTransaction.dateAdjusted = true;
                    break;
                }
            }
            
            return adjustedTransaction;
        });
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(Math.abs(amount));
    };

    const getTotalBalance = () => {
        return accounts.reduce((sum, account) => sum + (account.balance || 0), 0);
    };

    const TabButton = ({ tabId, label, isActive, onClick }) => (
        <button
            onClick={onClick}
            style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontWeight: '500',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: isActive ? '#2563eb' : '#f3f4f6',
                color: isActive ? 'white' : '#374151',
                transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
                if (!isActive) {
                    e.target.style.backgroundColor = '#e5e7eb';
                }
            }}
            onMouseOut={(e) => {
                if (!isActive) {
                    e.target.style.backgroundColor = '#f3f4f6';
                }
            }}
        >
            {label}
        </button>
    );

    const OverviewTab = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Summary Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '16px'
            }}>
                <div style={{
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: 'white',
                    padding: '24px',
                    borderRadius: '8px'
                }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: '600', margin: '0 0 8px 0' }}>Total Balance</h3>
                    <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>{formatCurrency(getTotalBalance())}</p>
                </div>

                <div style={{
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    color: 'white',
                    padding: '24px',
                    borderRadius: '8px'
                }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: '600', margin: '0 0 8px 0' }}>Connected Accounts</h3>
                    <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>{accounts.length}</p>
                </div>

                <div style={{
                    background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                    color: 'white',
                    padding: '24px',
                    borderRadius: '8px'
                }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: '600', margin: '0 0 8px 0' }}>Recent Transactions</h3>
                    <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>{transactions.length}</p>
                </div>
            </div>

            {/* Refresh Button */}
            {accounts.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                        onClick={refreshData}
                        disabled={loading}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: '#6b7280',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            opacity: loading ? 0.5 : 1
                        }}
                        onMouseOver={(e) => !loading && (e.target.style.backgroundColor = '#4b5563')}
                        onMouseOut={(e) => !loading && (e.target.style.backgroundColor = '#6b7280')}
                    >
                        {loading ? 'Refreshing...' : 'Refresh Data'}
                    </button>
                </div>
            )}

            {/* Accounts List */}
            {accounts.length > 0 && (
                <div style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    padding: '24px'
                }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '16px', margin: '0 0 16px 0' }}>
                        Your Accounts
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {accounts.map((account, index) => (
                            <div key={index} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '12px',
                                backgroundColor: '#f9fafb',
                                borderRadius: '6px'
                            }}>
                                <div>
                                    <p style={{ fontWeight: '500', margin: '0 0 4px 0' }}>{account.name}</p>
                                    <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0, textTransform: 'capitalize' }}>
                                        {account.type} • {account.subtype}
                                    </p>
                                </div>
                                <p style={{ fontSize: '1.125rem', fontWeight: '600', margin: 0 }}>
                                    {formatCurrency(account.balance)}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* No accounts message */}
            {accounts.length === 0 && (
                <div style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    padding: '48px',
                    textAlign: 'center'
                }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#6b7280', margin: '0 0 16px 0' }}>
                        No accounts connected yet
                    </h3>
                    <p style={{ color: '#9ca3af', margin: '0 0 24px 0' }}>
                        Connect your bank accounts to start analyzing your financial data
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                        {!linkToken && (
                            <button
                                onClick={createLinkToken}
                                style={{
                                    padding: '12px 24px',
                                    backgroundColor: '#2563eb',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '16px'
                                }}
                                onMouseOver={(e) => e.target.style.backgroundColor = '#1d4ed8'}
                                onMouseOut={(e) => e.target.style.backgroundColor = '#2563eb'}
                            >
                                Get Started
                            </button>
                        )}

                        {linkToken && (
                            <button
                                onClick={initializePlaidLink}
                                style={{
                                    padding: '12px 24px',
                                    backgroundColor: '#059669',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '16px'
                                }}
                                onMouseOver={(e) => e.target.style.backgroundColor = '#047857'}
                                onMouseOut={(e) => e.target.style.backgroundColor = '#059669'}
                            >
                                Connect Accounts
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );

    const TransactionsTab = () => {
        // Group transactions by month with adjustments
        const groupTransactionsByMonth = () => {
            // Apply early payment adjustments if not already applied
            const transactionsToGroup = transactions.every(t => t.hasOwnProperty('dateAdjusted')) 
                ? transactions 
                : adjustEarlyPayments(transactions);
            
            const grouped = {};
            transactionsToGroup.forEach(transaction => {
                const monthYear = new Date(transaction.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long'
                });
                if (!grouped[monthYear]) {
                    grouped[monthYear] = [];
                }
                grouped[monthYear].push(transaction);
            });
            
            // Sort months in descending order (newest first)
            return Object.keys(grouped)
                .sort((a, b) => new Date(b + ' 1') - new Date(a + ' 1'))
                .map(month => ({
                    month,
                    transactions: grouped[month].sort((a, b) => new Date(b.date) - new Date(a.date))
                }));
        };

        // Calculate monthly stats with adjustment info
        const calculateMonthlyStats = (monthTransactions) => {
            const expenses = monthTransactions.filter(t => t.amount > 0);
            const income = monthTransactions.filter(t => t.amount < 0);
            
            const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
            const totalIncome = income.reduce((sum, t) => sum + Math.abs(t.amount), 0);
            const netAmount = totalIncome - totalExpenses;
            const adjustedCount = monthTransactions.filter(t => t.dateAdjusted).length;

            // Category breakdown for expenses
            const categoryBreakdown = {};
            expenses.forEach(transaction => {
                const category = transaction.category && transaction.category.length > 0 
                    ? transaction.category[0] 
                    : 'Uncategorized';
                categoryBreakdown[category] = (categoryBreakdown[category] || 0) + transaction.amount;
            });

            // Merchant breakdown for expenses
            const merchantBreakdown = {};
            expenses.forEach(transaction => {
                if (transaction.merchant_name) {
                    const merchant = transaction.merchant_name;
                    merchantBreakdown[merchant] = (merchantBreakdown[merchant] || 0) + transaction.amount;
                }
            });

            return {
                totalExpenses,
                totalIncome,
                netAmount,
                categoryBreakdown: Object.entries(categoryBreakdown)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 6),
                merchantBreakdown: Object.entries(merchantBreakdown)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5),
                expenseCount: expenses.length,
                incomeCount: income.length,
                adjustedCount
            };
        };

        const [expandedMonths, setExpandedMonths] = useState(new Set());

        const toggleMonth = (month) => {
            const newExpanded = new Set(expandedMonths);
            if (newExpanded.has(month)) {
                newExpanded.delete(month);
            } else {
                newExpanded.add(month);
            }
            setExpandedMonths(newExpanded);
        };

        const monthlyData = groupTransactionsByMonth();

        return (
            <div style={{ 
                backgroundColor: 'white', 
                borderRadius: '8px', 
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)', 
                padding: '24px' 
            }}>
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginBottom: '24px' 
                }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>
                        Monthly Transactions & Analysis
                    </h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {accounts.length > 0 && transactions.length === 0 && (
                            <button
                                onClick={fetchTransactions}
                                disabled={loading}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: loading ? '#9ca3af' : '#2563eb',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    fontSize: '14px'
                                }}
                                onMouseOver={(e) => !loading && (e.target.style.backgroundColor = '#1d4ed8')}
                                onMouseOut={(e) => !loading && (e.target.style.backgroundColor = '#2563eb')}
                            >
                                {loading ? 'Loading...' : 'Load Transactions'}
                            </button>
                        )}
                        {transactions.length > 0 && (
                            <button
                                onClick={loadAllTransactions}
                                disabled={loading}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: loading ? '#9ca3af' : '#059669',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    fontSize: '14px'
                                }}
                                onMouseOver={(e) => !loading && (e.target.style.backgroundColor = '#047857')}
                                onMouseOut={(e) => !loading && (e.target.style.backgroundColor = '#059669')}
                            >
                                {loading ? 'Loading...' : 'Load All Transactions'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Early Payment Info Banner */}
                {transactions.length > 0 && (
                    <div style={{
                        backgroundColor: '#dbeafe',
                        border: '1px solid #93c5fd',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        marginBottom: '16px',
                        fontSize: '14px',
                        color: '#1e40af'
                    }}>
                        <strong>Early Payment Detection:</strong> Mortgage payments of $3,416.03 made 2+ days early 
                        are automatically moved to their intended month for accurate monthly analysis.
                    </div>
                )}

                {transactions.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '48px',
                        color: '#6b7280',
                        backgroundColor: '#f9fafb',
                        borderRadius: '8px'
                    }}>
                        <p style={{ margin: 0, fontSize: '16px' }}>
                            {accounts.length === 0 
                                ? "No transactions available. Connect your accounts first." 
                                : "Click 'Load Transactions' to fetch your recent transactions."
                            }
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {monthlyData.map(({ month, transactions: monthTransactions }) => {
                            const stats = calculateMonthlyStats(monthTransactions);
                            const isExpanded = expandedMonths.has(month);

                            return (
                                <div key={month} style={{
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    overflow: 'hidden'
                                }}>
                                    {/* Month Header */}
                                    <div 
                                        onClick={() => toggleMonth(month)}
                                        style={{
                                            backgroundColor: '#f9fafb',
                                            padding: '16px 20px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none'
                                        }}
                                        onMouseOver={(e) => e.target.style.backgroundColor = '#f3f4f6'}
                                        onMouseOut={(e) => e.target.style.backgroundColor = '#f9fafb'}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span style={{
                                                fontSize: '18px',
                                                fontWeight: '600',
                                                color: '#1f2937'
                                            }}>
                                                {month}
                                            </span>
                                            <span style={{
                                                fontSize: '14px',
                                                color: '#6b7280',
                                                backgroundColor: '#e5e7eb',
                                                padding: '2px 8px',
                                                borderRadius: '12px'
                                            }}>
                                                {monthTransactions.length} transactions
                                            </span>
                                            {stats.adjustedCount > 0 && (
                                                <span style={{
                                                    fontSize: '12px',
                                                    color: '#059669',
                                                    backgroundColor: '#d1fae5',
                                                    padding: '2px 6px',
                                                    borderRadius: '10px',
                                                    fontWeight: '500'
                                                }}>
                                                    {stats.adjustedCount} adjusted
                                                </span>
                                            )}
                                        </div>
                                        
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{ display: 'flex', gap: '12px', fontSize: '14px' }}>
                                                <span style={{ color: '#059669', fontWeight: '600' }}>
                                                    Income: +{formatCurrency(stats.totalIncome)}
                                                </span>
                                                <span style={{ color: '#dc2626', fontWeight: '600' }}>
                                                    Expenses: -{formatCurrency(stats.totalExpenses)}
                                                </span>
                                                <span style={{ 
                                                    color: stats.netAmount >= 0 ? '#059669' : '#dc2626',
                                                    fontWeight: '600'
                                                }}>
                                                    Net: {stats.netAmount >= 0 ? '+' : ''}{formatCurrency(Math.abs(stats.netAmount))}
                                                </span>
                                            </div>
                                            <span style={{
                                                fontSize: '18px',
                                                color: '#6b7280',
                                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                transition: 'transform 0.2s'
                                            }}>
                                                ▶
                                            </span>
                                        </div>
                                    </div>

                                    {/* Expanded Content */}
                                    {isExpanded && (
                                        <div style={{ padding: '20px' }}>
                                            {/* Show adjustment notice if applicable */}
                                            {stats.adjustedCount > 0 && (
                                                <div style={{
                                                    backgroundColor: '#f0fdf4',
                                                    border: '1px solid #bbf7d0',
                                                    borderRadius: '6px',
                                                    padding: '12px',
                                                    marginBottom: '16px',
                                                    fontSize: '14px',
                                                    color: '#15803d'
                                                }}>
                                                    <strong>Note:</strong> {stats.adjustedCount} transaction(s) were moved to this month 
                                                    from early payments made in the previous month.
                                                </div>
                                            )}

                                            {/* Summary Cards */}
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                                                gap: '16px',
                                                marginBottom: '24px'
                                            }}>
                                                {/* Category Breakdown */}
                                                <div style={{
                                                    backgroundColor: '#fef3c7',
                                                    padding: '16px',
                                                    borderRadius: '8px'
                                                }}>
                                                    <h4 style={{ 
                                                        fontSize: '16px', 
                                                        fontWeight: '600', 
                                                        color: '#92400e',
                                                        margin: '0 0 12px 0'
                                                    }}>
                                                        Top Expense Categories
                                                    </h4>
                                                    {stats.categoryBreakdown.length > 0 ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            {stats.categoryBreakdown.map(([category, amount]) => (
                                                                <div key={category} style={{
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    alignItems: 'center'
                                                                }}>
                                                                    <span style={{ 
                                                                        fontSize: '14px', 
                                                                        color: '#78350f',
                                                                        fontWeight: '500'
                                                                    }}>
                                                                        {category}
                                                                    </span>
                                                                    <span style={{ 
                                                                        fontSize: '14px', 
                                                                        color: '#92400e',
                                                                        fontWeight: '600'
                                                                    }}>
                                                                        {formatCurrency(amount)}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p style={{ margin: 0, color: '#78350f', fontSize: '14px' }}>
                                                            No expense categories
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Merchant Breakdown */}
                                                <div style={{
                                                    backgroundColor: '#dbeafe',
                                                    padding: '16px',
                                                    borderRadius: '8px'
                                                }}>
                                                    <h4 style={{ 
                                                        fontSize: '16px', 
                                                        fontWeight: '600', 
                                                        color: '#1e40af',
                                                        margin: '0 0 12px 0'
                                                    }}>
                                                        Top Merchants
                                                    </h4>
                                                    {stats.merchantBreakdown.length > 0 ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            {stats.merchantBreakdown.map(([merchant, amount]) => (
                                                                <div key={merchant} style={{
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    alignItems: 'center'
                                                                }}>
                                                                    <span style={{ 
                                                                        fontSize: '14px', 
                                                                        color: '#1e3a8a',
                                                                        fontWeight: '500',
                                                                        maxWidth: '150px',
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap'
                                                                    }}>
                                                                        {merchant}
                                                                    </span>
                                                                    <span style={{ 
                                                                        fontSize: '14px', 
                                                                        color: '#1e40af',
                                                                        fontWeight: '600'
                                                                    }}>
                                                                        {formatCurrency(amount)}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p style={{ margin: 0, color: '#1e3a8a', fontSize: '14px' }}>
                                                            No merchant data
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Transactions Table with adjustment indicators */}
                                            <div style={{
                                                overflowX: 'auto',
                                                borderRadius: '8px',
                                                border: '1px solid #e5e7eb'
                                            }}>
                                                <table style={{
                                                    width: '100%',
                                                    borderCollapse: 'collapse',
                                                    fontSize: '14px'
                                                }}>
                                                    <thead>
                                                        <tr style={{ backgroundColor: '#f3f4f6' }}>
                                                            <th style={{
                                                                padding: '10px 12px',
                                                                textAlign: 'left',
                                                                fontWeight: '600',
                                                                color: '#374151',
                                                                fontSize: '13px'
                                                            }}>Date</th>
                                                            <th style={{
                                                                padding: '10px 12px',
                                                                textAlign: 'left',
                                                                fontWeight: '600',
                                                                color: '#374151',
                                                                fontSize: '13px'
                                                            }}>Description</th>
                                                            <th style={{
                                                                padding: '10px 12px',
                                                                textAlign: 'left',
                                                                fontWeight: '600',
                                                                color: '#374151',
                                                                fontSize: '13px'
                                                            }}>Category</th>
                                                            <th style={{
                                                                padding: '10px 12px',
                                                                textAlign: 'right',
                                                                fontWeight: '600',
                                                                color: '#374151',
                                                                fontSize: '13px'
                                                            }}>Amount</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {monthTransactions.map((transaction, index) => {
                                                            const isExpense = transaction.amount > 0;
                                                            const formattedDate = new Date(transaction.date).toLocaleDateString('en-US', {
                                                                month: 'short',
                                                                day: 'numeric'
                                                            });

                                                            return (
                                                                <tr 
                                                                    key={index}
                                                                    style={{
                                                                        borderBottom: index < monthTransactions.length - 1 ? '1px solid #f3f4f6' : 'none',
                                                                        backgroundColor: transaction.dateAdjusted ? '#f0fdf4' : 'transparent'
                                                                    }}
                                                                    onMouseOver={(e) => e.target.closest('tr').style.backgroundColor = transaction.dateAdjusted ? '#ecfdf5' : '#f9fafb'}
                                                                    onMouseOut={(e) => e.target.closest('tr').style.backgroundColor = transaction.dateAdjusted ? '#f0fdf4' : 'transparent'}
                                                                >
                                                                    <td style={{
                                                                        padding: '10px 12px',
                                                                        color: '#6b7280',
                                                                        fontSize: '13px'
                                                                    }}>
                                                                        {formattedDate}
                                                                        {transaction.dateAdjusted && (
                                                                            <div style={{
                                                                                fontSize: '11px',
                                                                                color: '#059669',
                                                                                fontWeight: '500'
                                                                            }}>
                                                                                (adj. from {new Date(transaction.originalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    <td style={{
                                                                        padding: '10px 12px',
                                                                        color: '#1f2937',
                                                                        fontWeight: '500'
                                                                    }}>
                                                                        <div style={{
                                                                            maxWidth: '200px',
                                                                            overflow: 'hidden',
                                                                            textOverflow: 'ellipsis',
                                                                            whiteSpace: 'nowrap'
                                                                        }}>
                                                                            {transaction.name}
                                                                            {transaction.dateAdjusted && (
                                                                                <span style={{
                                                                                    marginLeft: '8px',
                                                                                    fontSize: '11px',
                                                                                    color: '#059669',
                                                                                    fontWeight: '600',
                                                                                    backgroundColor: '#d1fae5',
                                                                                    padding: '1px 4px',
                                                                                    borderRadius: '4px'
                                                                                }}>
                                                                                    EARLY
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        {transaction.merchant_name && (
                                                                            <div style={{
                                                                                fontSize: '12px',
                                                                                color: '#6b7280',
                                                                                marginTop: '2px'
                                                                            }}>
                                                                                {transaction.merchant_name}
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    <td style={{ padding: '10px 12px' }}>
                                                                        {transaction.category && transaction.category.length > 0 ? (
                                                                            <span style={{
                                                                                display: 'inline-block',
                                                                                backgroundColor: '#e0e7ff',
                                                                                color: '#3730a3',
                                                                                padding: '2px 6px',
                                                                                borderRadius: '10px',
                                                                                fontSize: '11px',
                                                                                fontWeight: '500'
                                                                            }}>
                                                                                {transaction.category[0]}
                                                                            </span>
                                                                        ) : (
                                                                            <span style={{
                                                                                color: '#9ca3af',
                                                                                fontSize: '12px'
                                                                            }}>
                                                                                -
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td style={{
                                                                        padding: '10px 12px',
                                                                        textAlign: 'right',
                                                                        fontWeight: '600',
                                                                        color: isExpense ? '#dc2626' : '#059669'
                                                                    }}>
                                                                        {isExpense ? '-' : '+'}{formatCurrency(transaction.amount)}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const InsightsTab = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>AI Financial Insights</h3>
                <button
                    onClick={generateInsights}
                    disabled={loading || accounts.length === 0}
                    style={{
                        padding: '12px 24px',
                        backgroundColor: loading || accounts.length === 0 ? '#9ca3af' : '#7c3aed',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: loading || accounts.length === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '16px'
                    }}
                    onMouseOver={(e) => {
                        if (!loading && accounts.length > 0) {
                            e.target.style.backgroundColor = '#6d28d9';
                        }
                    }}
                    onMouseOut={(e) => {
                        if (!loading && accounts.length > 0) {
                            e.target.style.backgroundColor = '#7c3aed';
                        }
                    }}
                >
                    {loading ? 'Generating...' : 'Generate Insights'}
                </button>
            </div>

            {insights ? (
                <div style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    padding: '24px'
                }}>
                    <h4 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '16px', margin: '0 0 16px 0' }}>
                        Latest Analysis
                    </h4>

                    {/* Show adjustment info if applicable */}
                    {insights.adjusted_transactions_count > 0 && (
                        <div style={{
                            backgroundColor: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: '6px',
                            padding: '12px',
                            marginBottom: '16px',
                            fontSize: '14px',
                            color: '#15803d'
                        }}>
                            <strong>Note:</strong> This analysis includes {insights.adjusted_transactions_count} transaction(s) 
                            that were adjusted for early payments to provide more accurate monthly insights.
                        </div>
                    )}

                    {insights.analysis ? (
                        <div style={{ maxWidth: 'none' }}>
                            <pre style={{
                                whiteSpace: 'pre-wrap',
                                fontSize: '14px',
                                backgroundColor: '#f9fafb',
                                padding: '16px',
                                borderRadius: '8px',
                                fontFamily: 'inherit'
                            }}>
                                {typeof insights.analysis === 'string' ? insights.analysis : JSON.stringify(insights.analysis, null, 2)}
                            </pre>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Financial Overview Cards */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                gap: '16px'
                            }}>
                                <div style={{
                                    padding: '16px',
                                    backgroundColor: '#dbeafe',
                                    borderRadius: '8px'
                                }}>
                                    <h5 style={{ fontSize: '16px', fontWeight: '600', color: '#1e40af', margin: '0 0 8px 0' }}>
                                        Savings Rate
                                    </h5>
                                    <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#1d4ed8', margin: 0 }}>
                                        {insights.savings_rate}%
                                    </p>
                                </div>

                                <div style={{
                                    padding: '16px',
                                    backgroundColor: '#ecfdf5',
                                    borderRadius: '8px'
                                }}>
                                    <h5 style={{ fontSize: '16px', fontWeight: '600', color: '#059669', margin: '0 0 8px 0' }}>
                                        Net Cash Flow
                                    </h5>
                                    <p style={{ 
                                        fontSize: '24px', 
                                        fontWeight: 'bold', 
                                        color: insights.net_cashflow >= 0 ? '#047857' : '#dc2626', 
                                        margin: 0 
                                    }}>
                                        {insights.net_cashflow >= 0 ? '+' : ''}{formatCurrency(insights.net_cashflow)}
                                    </p>
                                </div>

                                <div style={{
                                    padding: '16px',
                                    backgroundColor: '#fef3c7',
                                    borderRadius: '8px'
                                }}>
                                    <h5 style={{ fontSize: '16px', fontWeight: '600', color: '#92400e', margin: '0 0 8px 0' }}>
                                        Total Spending
                                    </h5>
                                    <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#b45309', margin: 0 }}>
                                        {formatCurrency(insights.total_spending)}
                                    </p>
                                </div>
                            </div>

                            {insights.top_categories && insights.top_categories.length > 0 && (
                                <div style={{
                                    padding: '16px',
                                    backgroundColor: '#fef3c7',
                                    borderRadius: '8px'
                                }}>
                                    <h5 style={{ fontSize: '16px', fontWeight: '600', color: '#92400e', margin: '0 0 12px 0' }}>
                                        Top Spending Categories
                                    </h5>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {insights.top_categories.map(([category, amount], index) => (
                                            <div key={index} style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}>
                                                <span style={{ color: '#78350f', fontWeight: '500' }}>{category}</span>
                                                <span style={{ color: '#92400e', fontWeight: '600' }}>{formatCurrency(amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {insights.recommendations && insights.recommendations.length > 0 && (
                                <div style={{
                                    padding: '16px',
                                    backgroundColor: '#f0fdf4',
                                    borderRadius: '8px'
                                }}>
                                    <h5 style={{ fontSize: '16px', fontWeight: '600', color: '#15803d', margin: '0 0 12px 0' }}>
                                        Recommendations
                                    </h5>
                                    <ul style={{ listStyle: 'disc', paddingLeft: '20px', color: '#166534', margin: 0 }}>
                                        {insights.recommendations.map((rec, index) => (
                                            <li key={index} style={{ marginBottom: '4px' }}>{rec}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Analysis Summary */}
                            <div style={{
                                padding: '16px',
                                backgroundColor: '#f3f4f6',
                                borderRadius: '8px',
                                fontSize: '14px',
                                color: '#4b5563'
                            }}>
                                <p style={{ margin: '0 0 8px 0' }}>
                                    <strong>Analysis Period:</strong> {insights.analysis_period} • 
                                    <strong> Transactions:</strong> {insights.transaction_count} • 
                                    <strong> Generated:</strong> {new Date(insights.generated_at).toLocaleString()}
                                </p>
                                {insights.adjusted_transactions_count > 0 && (
                                    <p style={{ margin: 0, color: '#059669' }}>
                                        <strong>Adjustments:</strong> {insights.adjusted_transactions_count} early payment(s) moved to correct months
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{
                    backgroundColor: '#f9fafb',
                    borderRadius: '8px',
                    padding: '48px',
                    textAlign: 'center'
                }}>
                    <p style={{ color: '#6b7280', margin: 0 }}>
                        {accounts.length === 0 
                            ? "Connect your accounts and generate insights to see AI-powered financial analysis"
                            : "Click 'Generate Insights' to analyze your financial data with early payment adjustments"
                        }
                    </p>
                </div>
            )}
        </div>
    );

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f3f4f6', padding: '24px' }}>
            <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                {/* Header */}
                <div style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    padding: '24px',
                    marginBottom: '24px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>
                                Financial AI Agent
                            </h1>
                            <p style={{ color: '#6b7280', marginTop: '4px', margin: '4px 0 0 0' }}>
                                Backend Status: <span style={{
                                    fontWeight: '600',
                                    color: status === 'healthy' ? '#059669' : '#dc2626'
                                }}>{status}</span>
                                {accounts.length > 0 && (
                                    <span style={{ color: '#6b7280', marginLeft: '16px' }}>
                                        • {accounts.length} account{accounts.length !== 1 ? 's' : ''} connected
                                    </span>
                                )}
                            </p>
                        </div>

                        {accounts.length === 0 && (
                            <div style={{ display: 'flex', gap: '12px' }}>
                                {!linkToken && (
                                    <button
                                        onClick={createLinkToken}
                                        style={{
                                            padding: '12px 24px',
                                            backgroundColor: '#2563eb',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontSize: '16px'
                                        }}
                                        onMouseOver={(e) => e.target.style.backgroundColor = '#1d4ed8'}
                                        onMouseOut={(e) => e.target.style.backgroundColor = '#2563eb'}
                                    >
                                        Create Link Token
                                    </button>
                                )}

                                {linkToken && (
                                    <button
                                        onClick={initializePlaidLink}
                                        style={{
                                            padding: '12px 24px',
                                            backgroundColor: '#059669',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontSize: '16px'
                                        }}
                                        onMouseOver={(e) => e.target.style.backgroundColor = '#047857'}
                                        onMouseOut={(e) => e.target.style.backgroundColor = '#059669'}
                                    >
                                        Connect Real Accounts
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                    <TabButton
                        tabId="overview"
                        label="Overview"
                        isActive={activeTab === 'overview'}
                        onClick={() => setActiveTab('overview')}
                    />
                    <TabButton
                        tabId="transactions"
                        label="Transactions"
                        isActive={activeTab === 'transactions'}
                        onClick={() => setActiveTab('transactions')}
                    />
                    <TabButton
                        tabId="insights"
                        label="AI Insights"
                        isActive={activeTab === 'insights'}
                        onClick={() => setActiveTab('insights')}
                    />
                </div>

                {/* Tab Content */}
                {activeTab === 'overview' && <OverviewTab />}
                {activeTab === 'transactions' && <TransactionsTab />}
                {activeTab === 'insights' && <InsightsTab />}

                {/* Loading Overlay */}
                {loading && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 50
                    }}>
                        <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '24px',
                                    height: '24px',
                                    border: '2px solid #e5e7eb',
                                    borderTop: '2px solid #2563eb',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite'
                                }}></div>
                                <p style={{ margin: 0 }}>Processing your financial data with early payment adjustments...</p>
                            </div>
                        </div>
                    </div>
                )}

                <style jsx>{`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        </div>
    );
};

export default FinancialAIAgent;