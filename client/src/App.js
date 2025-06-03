import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import Orders from './pages/Orders';
import GoogleAuthProvider from './components/GoogleOAuthProvider';
import { CartProvider } from './context/CartContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Menu from './pages/Menu';
import Login from './pages/Login';
import Register from './pages/Register';
import Subscriptions from './pages/Subscriptions';
import Dashboard from './pages/Dashboard';
import Cart from './pages/Cart';
import Contact from './pages/Contact'; 
function App() {
  return (
    <GoogleAuthProvider>
      <CartProvider>
        <Router>
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/menu" element={<Menu />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/orders" element={<Orders />} />
            </Routes>
          </Layout>
        </Router>
      </CartProvider>
    </GoogleAuthProvider>
  );
}

export default App;
