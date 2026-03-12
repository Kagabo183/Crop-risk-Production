import MobileHeader from './MobileHeader'
import BottomNav from './BottomNav'
import FloatingActionButton from './FloatingActionButton'

export default function MobileLayout({ children, apiStatus }) {
    return (
        <div className="mobile-app-layout">
            <MobileHeader apiStatus={apiStatus} />
            <div className="mobile-main">
                <div className="mobile-page-content">
                    {children}
                </div>
            </div>
            <BottomNav />
            <FloatingActionButton />
        </div>
    )
}

