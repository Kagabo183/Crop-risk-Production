# Quick Reference: Using New UX Components

## 🚀 Quick Start

Import what you need:
```jsx
import WelcomeBanner from '../components/WelcomeBanner';
import SimplifiedMetricCard from '../components/SimplifiedMetricCard';
import HealthScoreGauge from '../components/HealthScoreGauge';
import InsightCard from '../components/InsightCard';
import QuickActionButton from '../components/QuickActionButton';
import HelpTooltip from '../components/HelpTooltip';
```

---

## Component Cheat Sheet

### WelcomeBanner
```jsx
<WelcomeBanner 
  userName="John"
  onDismiss={() => setShowWelcome(false)} 
/>
```
**Props**: `userName` (optional), `onDismiss` (function)

---

### SimplifiedMetricCard
```jsx
<SimplifiedMetricCard
  icon="🚜"
  title="Total Farms"
  value={25}
  subtitle="Farms being monitored"
  trend={20}
  trendLabel="vs last week"
  helpText="Explanation here"
  onClick={() => navigate('/farms')}
  variant="success"  // success, warning, danger, default
/>
```
**Props**: 
- `icon` (string/element) - required
- `title` (string) - required
- `value` (string/number) - required
- `subtitle` (string) - optional
- `trend` (number) - optional, shows +/- indicator
- `trendLabel` (string) - optional
- `helpText` (string) - optional, shows tooltip
- `onClick` (function) - optional, makes card clickable
- `variant` (string) - optional, default: 'default'

---

### HealthScoreGauge
```jsx
<HealthScoreGauge 
  score={75}
  size="large"  // small, medium, large
  label="Overall Farm Health"
/>
```
**Props**:
- `score` (number 0-100) - required
- `size` (string) - optional, default: 'medium'
- `label` (string) - optional

**Auto Colors**:
- 80-100: Green (Excellent)
- 60-79: Blue (Good)
- 40-59: Orange (Fair)
- 0-39: Red (At Risk)

---

### InsightCard
```jsx
<InsightCard
  icon="🤖"
  title="AI Analysis Complete"
  description="We analyzed 150 data points..."
  actionText="View Details"
  onAction={() => navigate('/predictions')}
  variant="info"  // info, success, warning, tip
/>
```
**Props**:
- `icon` (string/element) - required
- `title` (string) - required
- `description` (string) - required
- `actionText` (string) - optional
- `onAction` (function) - optional
- `variant` (string) - optional, default: 'info'

---

### QuickActionButton
```jsx
<QuickActionButton
  icon="🗺️"
  label="View Risk Map"
  onClick={() => navigate('/risk-map')}
  variant="primary"  // primary, secondary, success, warning
  disabled={false}
/>
```
**Props**:
- `icon` (string/element) - required
- `label` (string) - required
- `onClick` (function) - required
- `variant` (string) - optional, default: 'primary'
- `disabled` (boolean) - optional, default: false

---

### HelpTooltip
```jsx
<h3>
  Crop Health Score
  <HelpTooltip 
    content="This score is calculated using AI analysis..."
    position="top"  // top, bottom, left, right
  />
</h3>
```
**Props**:
- `content` (string) - required
- `position` (string) - optional, default: 'top'

**Usage Tips**:
- Keep content under 100 words
- Use plain language
- Position auto-adjusts near screen edges

---

## Common Patterns

### Dashboard Header
```jsx
<div className="dashboard-header">
  <div className="header-content">
    <h1>
      Your Farm Dashboard
      <HelpTooltip content="Real-time health data from AI and satellites" />
    </h1>
    <p className="header-subtitle">
      Last updated: {new Date().toLocaleString()}
    </p>
  </div>
  <button onClick={refresh}>Refresh Data</button>
</div>
```

### Metrics Grid (4 columns)
```jsx
<div className="metrics-grid">
  {metrics.map(metric => (
    <SimplifiedMetricCard key={metric.id} {...metric} />
  ))}
</div>
```

### Quick Actions Grid
```jsx
<div className="quick-actions-grid">
  <QuickActionButton icon="🗺️" label="View Risk Map" onClick={...} />
  <QuickActionButton icon="📊" label="See Predictions" onClick={...} />
  <QuickActionButton icon="🌤️" label="Check Weather" onClick={...} />
  <QuickActionButton icon="🦠" label="Disease Alerts" onClick={...} />
</div>
```

### Insights Section
```jsx
<div className="insights-grid">
  <InsightCard
    icon="🤖"
    title="AI Analysis Complete"
    description={`Analyzed ${count} data points`}
    actionText="View Details"
    onAction={() => navigate('/predictions')}
    variant="info"
  />
  
  {hasIssues && (
    <InsightCard
      icon="⚠️"
      title="Attention Needed"
      description={`${issues} farms showing signs of stress`}
      actionText="Investigate"
      onAction={() => navigate('/farms')}
      variant="warning"
    />
  )}
</div>
```

---

## CSS Classes Reference

### Layout Classes
```css
.metrics-grid          /* Auto-fit grid, min 250px */
.quick-actions-grid    /* Auto-fit grid, min 240px */
.insights-grid         /* Auto-fit grid, min 320px */
```

### Utility Classes
```css
.dashboard-header      /* Flex, space-between */
.header-content        /* Flex column */
.header-subtitle       /* Muted text, small */
```

---

## Responsive Breakpoints

```css
/* Mobile */
@media (max-width: 768px) {
  .metrics-grid { grid-template-columns: 1fr; }
}

/* Tablet */
@media (min-width: 769px) and (max-width: 1024px) {
  .metrics-grid { grid-template-columns: repeat(2, 1fr); }
}

/* Desktop */
@media (min-width: 1025px) {
  .metrics-grid { grid-template-columns: repeat(4, 1fr); }
}
```

---

## State Management Tips

### Loading State
```jsx
const [loading, setLoading] = useState(true);

// In component
{loading ? (
  <SimplifiedMetricCard 
    icon="🚜" 
    title="Total Farms" 
    value="..." 
  />
) : (
  <SimplifiedMetricCard 
    icon="🚜" 
    title="Total Farms" 
    value={farms.length} 
  />
)}
```

### Conditional Insights
```jsx
{atRiskFarms > 0 && (
  <InsightCard
    icon="⚠️"
    title={`${atRiskFarms} Farms Need Attention`}
    description="Early intervention can prevent crop loss"
    actionText="Investigate"
    onAction={() => navigate('/predictions')}
    variant="warning"
  />
)}
```

---

## Accessibility Tips

✅ **Always provide helpText for technical terms**
```jsx
<SimplifiedMetricCard
  title="NDVI Score"
  helpText="Normalized Difference Vegetation Index measures plant health"
  {...props}
/>
```

✅ **Use semantic HTML**
```jsx
<section className="insights-section">
  <h2>Insights & Recommendations</h2>
  {/* content */}
</section>
```

✅ **Add ARIA labels**
```jsx
<button 
  onClick={refresh}
  aria-label="Refresh dashboard data"
>
  Refresh
</button>
```

---

## Performance Tips

✅ **Memoize expensive calculations**
```jsx
const overallHealth = useMemo(() => {
  return calculateHealth(farms);
}, [farms]);
```

✅ **Lazy load heavy components**
```jsx
const RiskMap = lazy(() => import('./RiskMap'));
```

✅ **Debounce user input**
```jsx
const debouncedSearch = useDebounce(searchTerm, 300);
```

---

## Testing Examples

### Component Testing
```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import SimplifiedMetricCard from './SimplifiedMetricCard';

test('renders metric card with value', () => {
  render(
    <SimplifiedMetricCard
      icon="🚜"
      title="Total Farms"
      value={25}
    />
  );
  expect(screen.getByText('25')).toBeInTheDocument();
  expect(screen.getByText('Total Farms')).toBeInTheDocument();
});

test('calls onClick when clicked', () => {
  const handleClick = jest.fn();
  render(
    <SimplifiedMetricCard
      icon="🚜"
      title="Total Farms"
      value={25}
      onClick={handleClick}
    />
  );
  fireEvent.click(screen.getByRole('button'));
  expect(handleClick).toHaveBeenCalled();
});
```

---

## Troubleshooting

### Component not showing up?
- Check import path
- Verify CSS file is imported
- Check parent container has height

### Tooltip not positioning correctly?
- Ensure parent has `position: relative`
- Try different `position` prop value
- Check z-index conflicts

### Colors look wrong?
- Verify CSS variables are defined
- Check for CSS specificity issues
- Ensure App.css is imported first

### Click not working?
- Check onClick prop is passed correctly
- Verify parent doesn't have pointer-events: none
- Check z-index stacking

---

## Version History

- **v2.0** (Jan 2026) - Initial UX overhaul
  - Created all new components
  - Redesigned dashboard
  - Improved accessibility

---

**Need Help?**
- Check [UX_UI_IMPROVEMENTS.md](./UX_UI_IMPROVEMENTS.md) for detailed docs
- See [VISUAL_COMPONENT_GUIDE.md](./VISUAL_COMPONENT_GUIDE.md) for visuals
- Review component source code for inline comments
