import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Badge, Button, Spinner, Alert, Toast, ToastContainer } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import axios from 'axios';
import API_BASE_URL from '../config/api';

function Menu() {
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  
  const navigate = useNavigate();
  const { addToCart } = useCart();

  useEffect(() => {
    fetchMenuItems();
  }, []);

  const fetchMenuItems = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/menu`);
      setMenuItems(response.data.data);
      setError(null);
    } catch (err) {
      setError('Failed to load menu items. Please try again.');
      console.error('Error fetching menu:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = (item) => {
    addToCart(item);
    setToastMessage(`${item.name} added to cart!`);
    setShowToast(true);
  };

  const filteredItems = selectedCategory === 'all' 
    ? menuItems 
    : menuItems.filter(item => item.category === selectedCategory);

  const categories = ['all', ...new Set(menuItems.map(item => item.category))];

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3">Loading delicious menu items...</p>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="py-5">
        <Alert variant="danger">
          {error}
          <Button variant="outline-danger" className="ms-3" onClick={fetchMenuItems}>
            Try Again
          </Button>
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      {/* Toast Notification */}
      <ToastContainer position="top-end" className="p-3">
        <Toast 
          show={showToast} 
          onClose={() => setShowToast(false)} 
          delay={3000} 
          autohide
          bg="success"
        >
          <Toast.Body className="text-white">
            {toastMessage}
          </Toast.Body>
        </Toast>
      </ToastContainer>

      {/* Page Header */}
      <Row className="mb-5">
        <Col className="text-center">
          <h1 className="display-4">Our Menu</h1>
          <p className="lead text-muted">
            Authentic Indian tiffin meals prepared with love और fresh ingredients
          </p>
        </Col>
      </Row>

      {/* Category Filter */}
      <Row className="mb-4">
        <Col>
          <div className="d-flex flex-wrap gap-2 justify-content-center">
            {categories.map(category => (
              <Button
                key={category}
                variant={selectedCategory === category ? 'primary' : 'outline-primary'}
                onClick={() => setSelectedCategory(category)}
                className="text-capitalize"
              >
                {category === 'all' ? 'All Items' : category}
              </Button>
            ))}
          </div>
        </Col>
      </Row>

      {/* Menu Items */}
      <Row>
        {filteredItems.length === 0 ? (
          <Col className="text-center">
            <p className="text-muted">No items found in this category.</p>
          </Col>
        ) : (
          filteredItems.map(item => (
            <Col md={6} lg={4} key={item.id} className="mb-4">
              <Card className="h-100 shadow-sm border-0">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <Card.Title className="h5">{item.name}</Card.Title>
                    <div>
                      {item.is_vegetarian ? (
                        <Badge bg="success" className="me-1">🌿 Veg</Badge>
                      ) : (
                        <Badge bg="danger" className="me-1">🍗 Non-Veg</Badge>
                      )}
                      {item.is_daily && (
                        <Badge bg="info">Daily</Badge>
                      )}
                    </div>
                  </div>
                  
                  <Card.Text className="text-muted mb-3">
                    {item.description}
                  </Card.Text>
                  
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <span className="h4 text-primary">₹{item.price}</span>
                      <small className="text-muted">/day</small>
                    </div>
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={() => handleAddToCart(item)}
                    >
                      Add to Cart
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          ))
        )}
      </Row>

      {/* Call to Action */}
      <Row className="mt-5">
        <Col className="text-center">
          <div className="bg-light p-4 rounded">
            <h4>Want Regular Delivery?</h4>
            <p className="text-muted mb-3">
              Subscribe to our weekly or monthly plans and save more!
            </p>
            <Button 
              variant="success" 
              size="lg"
              onClick={() => navigate('/subscriptions')}
            >
              View Subscription Plans
            </Button>
          </div>
        </Col>
      </Row>
    </Container>
  );
}

export default Menu;
