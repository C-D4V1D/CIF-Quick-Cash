import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadialBarChart, RadialBar, PieChart, Pie, Cell,
  LineChart, Line,
} from 'recharts';
import { COLORS } from '../theme';

const fmtMoney = (n) => '₦' + Number(n || 0).toLocaleString();
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function KpiCard({ icon, value, label, trend, sub, color }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '12px', padding: '20px',
      border: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      <div style={{ fontSize: '24px', lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: '26px', fontWeight: 800, color: color || COLORS.primary, lineHeight: 1.1 }}>{value}</div>
      {trend !== undefined && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: trend >= 0 ? '#10b981' : COLORS.danger }}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last month
        </div>
      )}
      <div style={{ fontSize: '12px', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      {sub && <div style={{ fontSize: '12px', color: COLORS.textMuted }}>{sub}</div>}
    </div>
  );
}

function getLast6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_NAMES[d.getMonth()] });
  }
  return months;
}

export default function StaffPerformance({ currentUser, transactions, settings, isMobile }) {
  const months = getLast6Months();
  const nowMonth = new Date().getMonth();
  const nowYear = new Date().getFullYear();
  const prevMonth = nowMonth === 0 ? 11 : nowMonth - 1;
  const prevYear = nowMonth === 0 ? nowYear - 1 : nowYear;

  // All transactions created by this user (matched by name)
  const myTxs = useMemo(() =>
    transactions.filter(tx => tx.createdBy === currentUser.name || tx.completedBy === currentUser.name),
    [transactions, currentUser.name]
  );

  // This month's transactions
  const thisMonthTxs = myTxs.filter(tx => {
    const d = new Date(tx.dateGiven || tx.createdAt || '');
    return d.getMonth() === nowMonth && d.getFullYear() === nowYear;
  });

  // Last month
  const lastMonthTxs = myTxs.filter(tx => {
    const d = new Date(tx.dateGiven || tx.createdAt || '');
    return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
  });

  // Core stats
  const totalValue = myTxs.reduce((s, tx) => s + (tx.cashAdvance || 0), 0);
  const activeLoans = myTxs.filter(tx => tx.status === 'active').length;
  const defaulted = myTxs.filter(tx => tx.status === 'for_sale' || tx.status === 'ready_to_sell' || tx.status === 'sold').length;
  const closed = myTxs.filter(tx => tx.status === 'closed').length;
  const avgLoan = myTxs.length > 0 ? totalValue / myTxs.length : 0;
  const defaultRate = myTxs.length > 0 ? ((defaulted / myTxs.length) * 100).toFixed(1) : '0.0';
  const thisMonthChange = lastMonthTxs.length > 0
    ? Math.round(((thisMonthTxs.length - lastMonthTxs.length) / lastMonthTxs.length) * 100)
    : null;

  // Team average (all staff, same month)
  const allStaffThisMonth = transactions.filter(tx => {
    const d = new Date(tx.dateGiven || tx.createdAt || '');
    return d.getMonth() === nowMonth && d.getFullYear() === nowYear;
  });
  const staffCounts = {};
  allStaffThisMonth.forEach(tx => {
    const by = tx.createdBy || tx.completedBy;
    if (by) staffCounts[by] = (staffCounts[by] || 0) + 1;
  });
  const staffValues = Object.values(staffCounts);
  const teamAvg = staffValues.length > 0 ? Math.round(staffValues.reduce((a, b) => a + b, 0) / staffValues.length) : 0;
  const myMonthCount = thisMonthTxs.length;
  const beatTeam = myMonthCount >= teamAvg;

  // Monthly activity chart data (last 6 months)
  const chartData = months.map(({ year, month, label }) => {
    const count = myTxs.filter(tx => {
      const d = new Date(tx.dateGiven || tx.createdAt || '');
      return d.getMonth() === month && d.getFullYear() === year;
    }).length;
    const value = myTxs.filter(tx => {
      const d = new Date(tx.dateGiven || tx.createdAt || '');
      return d.getMonth() === month && d.getFullYear() === year;
    }).reduce((s, tx) => s + (tx.cashAdvance || 0), 0);
    return { month: label, count, value };
  });

  // Monthly target (from settings or default 20)
  const monthlyTarget = Number(settings?.staffMonthlyTarget) || 20;
  const targetPct = Math.min(100, Math.round((myMonthCount / monthlyTarget) * 100));
  const ringData = [{ name: 'Done', value: targetPct }, { name: 'Left', value: 100 - targetPct }];
  const RING_COLORS = [COLORS.primary, COLORS.border];

  // Team vs me bar data
  const compareData = [
    { name: 'You', value: myMonthCount, fill: COLORS.primary },
    { name: 'Team Avg', value: teamAvg, fill: COLORS.accent },
  ];

  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: `1px solid ${COLORS.border}`, marginBottom: '20px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '16px' : '20px 24px', borderBottom: `1px solid ${COLORS.border}`, background: `linear-gradient(90deg, ${COLORS.primaryLight}, #fff)` }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: '8px' }}>
          💼 Your Performance Stats
        </h3>
        <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '4px' }}>
          Based on transactions you've created or processed — this month & all time
        </div>
      </div>

      <div style={{ padding: isMobile ? '16px' : '20px 24px' }}>
        {/* This month target ring + comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          {/* Donut ring */}
          <div style={{ background: COLORS.bg, borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '12px', color: COLORS.primaryDark }}>
              This Month's Progress
            </div>
            <div style={{ position: 'relative', height: '140px' }}>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={ringData} cx="50%" cy="50%" innerRadius={48} outerRadius={64} startAngle={90} endAngle={-270} dataKey="value" stroke="none">
                    {ringData.map((entry, i) => <Cell key={i} fill={RING_COLORS[i]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color: COLORS.primary }}>{targetPct}%</div>
                <div style={{ fontSize: '10px', color: COLORS.textMuted, fontWeight: 600 }}>of target</div>
              </div>
            </div>
            <div style={{ fontSize: '13px', color: COLORS.text, fontWeight: 600 }}>
              {myMonthCount} of {monthlyTarget} transactions
            </div>
            <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>
              {monthlyTarget - myMonthCount > 0 ? `${monthlyTarget - myMonthCount} more to hit your target` : '🎉 Target reached!'}
            </div>
          </div>

          {/* You vs Team */}
          <div style={{ background: COLORS.bg, borderRadius: '12px', padding: '20px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '12px', color: COLORS.primaryDark }}>
              You vs. Team Average
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={compareData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 700 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v} transactions`, '']} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {compareData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize: '13px', fontWeight: 600, color: beatTeam ? COLORS.primary : COLORS.warning, textAlign: 'center', marginTop: '8px' }}>
              {beatTeam
                ? `You processed ${myMonthCount} loans this month. Team avg: ${teamAvg} ✅`
                : `Team avg is ${teamAvg}. You're at ${myMonthCount} — keep pushing! 💪`}
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          <KpiCard icon="📋" value={myTxs.length} label="Total loans (all time)" trend={thisMonthChange} />
          <KpiCard icon="💰" value={fmtMoney(totalValue)} label="Total value issued" />
          <KpiCard icon="✅" value={closed} label="Repayments collected" />
          <KpiCard icon="📊" value={fmtMoney(avgLoan)} label="Avg loan amount" />
          <KpiCard icon="⏳" value={activeLoans} label="Active loans now" color="#2563eb" />
          <KpiCard icon="⚠️" value={`${defaulted} (${defaultRate}%)`} label="Defaulted / at risk" color={defaulted > 0 ? COLORS.danger : COLORS.primary} />
        </div>

        {/* Monthly activity chart */}
        <div style={{ background: COLORS.bg, borderRadius: '12px', padding: isMobile ? '14px' : '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '16px', color: COLORS.primaryDark }}>
            📅 Your Activity — Last 6 Months
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v, name) => [name === 'count' ? `${v} transactions` : fmtMoney(v), name === 'count' ? 'Transactions' : 'Value']}
              />
              <Bar dataKey="count" name="count" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {myTxs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: COLORS.textMuted, fontSize: '13px', marginTop: '-160px', position: 'relative', zIndex: 2 }}>
              No transactions recorded yet — start processing loans to see your stats here 🚀
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
