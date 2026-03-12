import { createContext, useContext, useState } from 'react';

const TitleContext = createContext();

export function useTitle() {
  return useContext(TitleContext);
}

export function TitleProvider({ children }) {
  const [title, setTitle] = useState('Dashboard');

  const value = {
    title,
    setTitle,
  };

  return (
    <TitleContext.Provider value={value}>
      {children}
    </TitleContext.Provider>
  );
}
