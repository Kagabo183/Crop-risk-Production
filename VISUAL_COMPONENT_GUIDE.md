# Visual Component Guide

## 🎨 Component Showcase

This guide shows what each new component looks like and how to use it.

---

## 1. WelcomeBanner

**What it does**: Greets users and introduces key features

**Visual Style**:
```
┌─────────────────────────────────────────────────────────────┐
│ 🌱  Welcome to Your Crop Health Dashboard! 🌱              [×]│
│                                                               │
│ Monitor your farm's health in real-time using AI-powered     │
│ satellite analysis. Get alerts about potential risks and     │
│ make informed decisions to protect your crops.               │
│                                                               │
│ ┌────────────┬────────────┬────────────┬────────────┐       │
│ │ 📊         │ 🗺️         │ ⚠️         │ 🤖         │       │
│ │ View health│ See risk   │ Get instant│ AI predicts│       │
│ │ scores     │ maps       │ alerts     │ problems   │       │
│ └────────────┴────────────┴────────────┴────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**Colors**: Green gradient background, white text
**Behavior**: Dismissible (click X), shows once per session

---

## 2. SimplifiedMetricCard

**What it does**: Shows key metrics in an easy-to-understand format

**Visual Style**:
```
┌──────────────────────────────┐
│ 🚜  Total Farms         [ⓘ] │
│                              │
│        25                    │
│                              │
│ Farms being monitored        │
│                              │
│ ↗ 20% vs last week          │
└──────────────────────────────┘
```

**Variants**:
- `success`: Green left border
- `warning`: Orange left border  
- `danger`: Red left border
- `default`: No colored border

**States**:
- Hover: Lifts up, green border appears
- Click: Navigates to detail page

---

## 3. HealthScoreGauge

**What it does**: Shows overall health score as circular progress

**Visual Style**:
```
        ╱───────╲
      ╱           ╲
    │      75      │   (75% filled circle)
    │   Excellent  │   (Green color)
      ╲           ╱
        ╲───────╱
     Overall Health
```

**Color Logic**:
- 80-100: Green (Excellent)
- 60-79: Blue (Good)
- 40-59: Orange (Fair)
- 0-39: Red (At Risk)

**Sizes**: Small (100px), Medium (140px), Large (180px)

---

## 4. InsightCard

**What it does**: Provides contextual recommendations and tips

**Visual Style**:
```
┌────────────────────────────────────────────────┐
│ ┌────┐                                         │
│ │ 🤖 │  AI Analysis Complete                  │
│ └────┘                                         │
│                                                 │
│ We've analyzed 150 data points from satellite  │
│ imagery to predict crop health across your     │
│ farms.                                          │
│                                                 │
│ [View Details →]                               │
└────────────────────────────────────────────────┘
```

**Variants**:
- `info`: Blue left border
- `success`: Green left border
- `warning`: Orange left border
- `tip`: Purple left border

**Behavior**: Click action button to navigate

---

## 5. QuickActionButton

**What it does**: Large, clickable button for common actions

**Visual Style**:
```
┌─────────────────────────────────────┐
│ 🗺️   View Risk Map              → │
└─────────────────────────────────────┘
```

**Variants**:
- `primary`: Green gradient
- `secondary`: Blue gradient
- `success`: Dark green gradient
- `warning`: Orange gradient

**States**:
- Hover: Lifts up, arrow slides right
- Click: Subtle press animation

---

## 6. HelpTooltip

**What it does**: Shows explanatory text on hover

**Visual Style**:
```
Crop Health Score [ⓘ]
         ↓ (on hover)
    ┌─────────────────────────────────┐
    │ This score is calculated using  │
    │ AI analysis of satellite        │
    │ imagery and weather data.       │
    └─────────────────────────────────┘
```

**Positions**: top, bottom, left, right (auto-adjusts)
**Behavior**: Shows on hover, hides on mouse leave
**Max Width**: 280px

---

## 📱 Responsive Behavior

### Desktop (> 1024px)
```
┌─────────────────────────────────────────────────────┐
│ Sidebar │ Dashboard Content (max 1400px, centered) │
│  280px  │                                           │
│         │  [Metrics in 4 columns]                  │
│         │  [Quick actions in 4 columns]            │
│         │  [Insights in 2 columns]                 │
└─────────────────────────────────────────────────────┘
```

### Tablet (768px - 1024px)
```
┌───────────────────────────────────┐
│ Sidebar │ Dashboard Content       │
│  280px  │                         │
│         │ [Metrics in 2 columns] │
│         │ [Quick actions in 2]   │
│         │ [Insights in 1-2]      │
└───────────────────────────────────┘
```

### Mobile (< 768px)
```
┌──────────────────────┐
│  Dashboard Content   │
│                      │
│ [All single column] │
│ [Stacked vertically]│
│ [Full width buttons]│
└──────────────────────┘
```

---

## 🎨 Color Reference

### Primary Colors
```css
--primary-500: #10b981  /* Main green */
--primary-600: #059669  /* Darker green */
--primary-700: #047857  /* Even darker */
```

### Status Colors
```css
--success: #10b981  /* Green */
--warning: #f59e0b  /* Orange */
--danger: #ef4444   /* Red */
--info: #3b82f6     /* Blue */
```

### Neutral Colors
```css
--gray-900: #111827  /* Dark text */
--gray-700: #374151  /* Medium text */
--gray-500: #6b7280  /* Light text */
--gray-100: #f3f4f6  /* Very light bg */
```

---

## 🎯 Usage Examples

### Example 1: Dashboard Overview Section
```jsx
<div className="dashboard-overview">
  <HealthScoreGauge 
    score={75} 
    size="large" 
    label="Overall Farm Health" 
  />
  
  <div className="metrics-grid">
    <SimplifiedMetricCard
      icon="🚜"
      title="Total Farms"
      value={25}
      subtitle="Farms being monitored"
      helpText="Total number of farms in your portfolio"
      variant="success"
    />
    {/* More cards... */}
  </div>
</div>
```

### Example 2: Quick Actions Section
```jsx
<div className="quick-actions">
  <h2>
    Quick Actions
    <HelpTooltip content="Common tasks you can perform" />
  </h2>
  
  <div className="actions-grid">
    <QuickActionButton
      icon="🗺️"
      label="View Risk Map"
      onClick={() => navigate('/risk-map')}
      variant="primary"
    />
    {/* More buttons... */}
  </div>
</div>
```

### Example 3: Insights Section
```jsx
<div className="insights">
  <h2>Insights & Recommendations</h2>
  
  <div className="insights-grid">
    <InsightCard
      icon="🤖"
      title="AI Analysis Complete"
      description="We analyzed 150 data points..."
      actionText="View Details"
      onAction={() => navigate('/predictions')}
      variant="info"
    />
    {/* More insights... */}
  </div>
</div>
```

---

## 🔍 Interactive States

### Hover States
- **Cards**: Lift up 2px, add shadow
- **Buttons**: Scale up slightly, brighten
- **Tooltips**: Fade in smoothly
- **Links**: Color shift, underline

### Focus States (Keyboard Navigation)
- Blue outline (2px solid)
- Sufficient contrast for visibility
- Tab order follows logical flow

### Loading States
- Skeleton screens for cards
- Spinner for buttons
- Disabled state with opacity

### Error States
- Red border on inputs
- Error message below field
- Icon indicator

---

## 📐 Spacing System

```
--space-xs:  8px   (Small gaps)
--space-sm:  12px  (Card padding)
--space-md:  16px  (Standard spacing)
--space-lg:  24px  (Section spacing)
--space-xl:  32px  (Major sections)
--space-2xl: 48px  (Page sections)
```

---

## 🎭 Animation Guidelines

### Durations
- **Fast**: 0.15s (hover effects)
- **Normal**: 0.25s (transitions)
- **Slow**: 0.35s (page transitions)

### Easing
```css
cubic-bezier(0.4, 0, 0.2, 1)  /* Smooth ease */
```

### What to Animate
✅ Transform (scale, translate)
✅ Opacity
✅ Background color
❌ Width/Height (use transform instead)
❌ Margin/Padding (layout shift)

---

## 📊 Accessibility Checklist

✅ Color contrast ratio ≥ 4.5:1 (WCAG AA)
✅ All interactive elements keyboard accessible
✅ Focus indicators visible
✅ Alt text on images/icons
✅ ARIA labels on buttons
✅ Semantic HTML (h1, h2, nav, etc.)
✅ Touch targets ≥ 44x44px
✅ No flashing content

---

## 🎨 Design Tokens Quick Reference

```css
/* Border Radius */
--radius-sm: 6px   /* Small elements */
--radius-md: 8px   /* Standard */
--radius-lg: 12px  /* Cards */
--radius-xl: 16px  /* Large cards */

/* Shadows */
--shadow-sm: 0 1px 3px rgba(0,0,0,0.1)
--shadow-md: 0 4px 6px rgba(0,0,0,0.1)
--shadow-lg: 0 10px 15px rgba(0,0,0,0.1)

/* Typography */
Font Family: System font stack
Base Size: 14px
Line Height: 1.6
Headings: 700 weight
Body: 400 weight
```

---

**Last Updated**: January 19, 2026
**Design System Version**: 2.0
