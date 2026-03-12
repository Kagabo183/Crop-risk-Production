import Sidebar from './Sidebar'
import Header from './Header'
import { useState } from 'react'

export default function WebLayout({ children, titles, apiStatus }) {
    const [sidebarOpen, setSidebarOpen] = useState(true)

    return (
        <div className="web-layout">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <div className={`web-main ${sidebarOpen ? 'sidebar-open' : ''}`}>
                <Header
                    titles={titles}
                    apiStatus={apiStatus}
                    onMenuClick={() => setSidebarOpen(!sidebarOpen)}
                />
                <main className="web-content">
                    {children}
                </main>
            </div>
        </div>
    )
}
