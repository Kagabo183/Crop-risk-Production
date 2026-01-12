
import React from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const Sidebar = () => (
  <aside className="sidebar">
    <div className="sidebar-logo">CropRisk</div>
    <nav className="sidebar-nav">
      <ul>
        <li><NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>Dashboard</NavLink></li>
        <li><NavLink to="/farms" className={({ isActive }) => isActive ? 'active' : ''}>Farms</NavLink></li>
        <li><NavLink to="/predictions" className={({ isActive }) => isActive ? 'active' : ''}>Predictions</NavLink></li>
        <li><NavLink to="/risk-map" className={({ isActive }) => isActive ? 'active' : ''}>Risk Map</NavLink></li>
        <li><NavLink to="/diseases" className={({ isActive }) => isActive ? 'active' : ''}>Disease Predictions</NavLink></li>
        <li><NavLink to="/disease-forecasts" className={({ isActive }) => isActive ? 'active' : ''}>Disease Forecasts</NavLink></li>
        <li><NavLink to="/weather" className={({ isActive }) => isActive ? 'active' : ''}>Weather</NavLink></li>
        <li><NavLink to="/alerts" className={({ isActive }) => isActive ? 'active' : ''}>Alerts</NavLink></li>
        <li><NavLink to="/data-status" className={({ isActive }) => isActive ? 'active' : ''}>Data Status</NavLink></li>
        <li><NavLink to="/users" className={({ isActive }) => isActive ? 'active' : ''}>Users</NavLink></li>
        <li><NavLink to="/satellite-images" className={({ isActive }) => isActive ? 'active' : ''}>Satellite Images</NavLink></li>
        <li><NavLink to="/crop-type" className={({ isActive }) => isActive ? 'active' : ''}>Crop Type</NavLink></li>
      </ul>
    </nav>
  </aside>
);

export default Sidebar;
