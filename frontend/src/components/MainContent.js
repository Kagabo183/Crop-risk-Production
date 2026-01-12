
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Dashboard from '../components/Dashboard';
import Farms from '../pages/Farms';
import Predictions from '../pages/Predictions';
import Alerts from '../pages/Alerts';
import Users from '../pages/Users';
import SatelliteImages from '../pages/SatelliteImages';
import CropType from '../pages/CropType';
import Diseases from '../pages/Diseases';
import DiseaseForecasts from '../pages/DiseaseForecasts';
import Weather from '../pages/Weather';
import DataStatus from '../components/DataStatus';
import RiskMap from '../components/RiskMap';
import './MainContent.css';

const MainContent = () => (
  <main className="main-content">
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/farms" element={<Farms />} />
      <Route path="/predictions" element={<Predictions />} />
      <Route path="/risk-map" element={<RiskMap />} />
      <Route path="/diseases" element={<Diseases />} />
      <Route path="/disease-forecasts" element={<DiseaseForecasts />} />
      <Route path="/weather" element={<Weather />} />
      <Route path="/alerts" element={<Alerts />} />
      <Route path="/data-status" element={<DataStatus />} />
      <Route path="/users" element={<Users />} />
      <Route path="/satellite-images" element={<SatelliteImages />} />
      <Route path="/crop-type" element={<CropType />} />
    </Routes>
  </main>
);

export default MainContent;
