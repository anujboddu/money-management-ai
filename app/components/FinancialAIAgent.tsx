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

    // Check backend status
    useEffect(() => {
        fetch(`${API_BASE}/health`)
            .then((res) => res.json())
            .then((data) => setStatus(data.status))
            .catch(() => setStatus("offline"));
    }, []);

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

                        // Fetch accounts
                        loadAccounts();

                        // Fetch transactions
                        fetchTransactions();

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
        </div>
    );

    const TransactionsTab = () => (
        <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4">Recent Transactions</h3>
            {transactions.length === 0 ? (
                <p className="text-gray-600">No transactions available. Connect your accounts first.</p>
            ) : (
                <div className="space-y-3">
                    {transactions.slice(0, 20).map((transaction, index) => (
                        <div key={index} className="flex justify-between items-center p-3 border-b">
                            <div>
                                <p className="font-medium">{transaction.name}</p>
                                <p className="text-sm text-gray-600">{transaction.date}</p>
                                {transaction.category && (
                                    <p className="text-xs text-blue-600">{transaction.category.join(', ')}</p>
                                )}
                            </div>
                            <p className={`text-lg font-semibold ${transaction.amount > 0 ? 'text-red-600' : 'text-green-600'
                                }`}>
                                {transaction.amount > 0 ? '-' : '+'}{formatCurrency(transaction.amount)}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const InsightsTab = () => (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold">AI Financial Insights</h3>
                <button
                    onClick={generateInsights}
                    disabled={loading || accounts.length === 0}
                    className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 disabled:opacity-50"
                >
                    {loading ? 'Generating...' : 'Generate Insights'}
                </button>
            </div>

            {insights ? (
                <div className="bg-white rounded-lg shadow p-6">
                    <h4 className="text-lg font-semibold mb-4">Latest Analysis</h4>

                    {insights.analysis ? (
                        <div className="prose max-w-none">
                            <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded">
                                {typeof insights.analysis === 'string' ? insights.analysis : JSON.stringify(insights.analysis, null, 2)}
                            </pre>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {insights.savings_rate && (
                                <div className="p-4 bg-blue-50 rounded-lg">
                                    <h5 className="font-semibold text-blue-800">Savings Rate</h5>
                                    <p className="text-blue-700">{insights.savings_rate}</p>
                                </div>
                            )}

                            {insights.top_spending_categories && (
                                <div className="p-4 bg-yellow-50 rounded-lg">
                                    <h5 className="font-semibold text-yellow-800">Top Spending Categories</h5>
                                    <ul className="text-yellow-700">
                                        {insights.top_spending_categories.map(([category, amount], index) => (
                                            <li key={index}>{category}: {formatCurrency(amount)}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {insights.recommendations && (
                                <div className="p-4 bg-green-50 rounded-lg">
                                    <h5 className="font-semibold text-green-800">Recommendations</h5>
                                    <ul className="list-disc list-inside text-green-700">
                                        {insights.recommendations.map((rec, index) => (
                                            <li key={index}>{rec}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                    <p className="text-gray-600">
                        Connect your accounts and generate insights to see AI-powered financial analysis
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
                                <p style={{ margin: 0 }}>Processing your financial data...</p>
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