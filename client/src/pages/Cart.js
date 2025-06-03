import React from 'react';
import { Container, Row, Col, Card, Button, Badge, Alert } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

function Cart() {
  const { cartItems, addToCart, removeFromCart, clearCart, getCartTotal } = useCart();
  const navigate = useNavigate();

  if (cartItems.length === 0) {
    return (
      <Container className="py-5">
        <Row>
          <Col className="text-center">
            <div style={{ fontSize: '100px' }}>🛒</div>
            <h3>Your Cart is Empty</h3>
            <p className="text-muted">Add some delicious tiffin items to get started!</p>
            <Button variant="primary" onClick={() => navigate('/menu')}>
              Browse Menu
            </Button>
          </Col>
        </Row>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>Your Cart ({cartItems.length} items)</h2>
            <Button variant="outline-danger" onClick={clearCart}>
              Clear Cart
            </Button>
          </div>
        </Col>
      </Row>

      <Row>
        <Col lg={8}>
          {cartItems.map((item) => (
            <Card key={item.id} className="mb-3">
              <Card.Body>
                <Row className="align-items-center">
                  <Col md={6}>
                    <h5>{item.name}</h5>
                    <p className="text-muted mb-1">{item.description}</p>
                    <div>
                      {item.is_vegetarian ? (
                        <Badge bg="success" className="me-2">🌿 Veg</Badge>
                      ) : (
                        <Badge bg="danger" className="me-2">🍗 Non-Veg</Badge>
                      )}
                      {item.is_daily && (
                        <Badge bg="info">Daily</Badge>
                      )}
                    </div>
                  </Col>
                  
                  <Col md={3}>
                    <div className="d-flex align-items-center justify-content-center">
                      <Button 
                        variant="outline-secondary" 
                        size="sm"
                        onClick={() => removeFromCart(item)}
                      >
                        -
                      </Button>
                      <span className="mx-3 fw-bold">{item.quantity}</span>
                      <Button 
                        variant="outline-secondary" 
                        size="sm"
                        onClick={() => addToCart(item)}
                      >
                        +
                      </Button>
                    </div>
                  </Col>
                  
                  <Col md={3} className="text-end">
                    <div>
                      <span className="h5 text-primary">₹{item.price}</span>
                      <small className="text-muted"> each</small>
                    </div>
                    <div>
                      <strong>₹{(parseFloat(item.price) * item.quantity).toFixed(2)}</strong>
                    </div>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          ))}
        </Col>

        {/* Order Summary */}
        <Col lg={4}>
          <Card className="sticky-top">
            <Card.Header>
              <h5>Order Summary</h5>
            </Card.Header>
            <Card.Body>
              <div className="d-flex justify-content-between mb-2">
                <span>Subtotal:</span>
                <span>₹{getCartTotal().toFixed(2)}</span>
              </div>
              <div className="d-flex justify-content-between mb-2">
                <span>Delivery Fee:</span>
                <span>₹20.00</span>
              </div>
              <div className="d-flex justify-content-between mb-2">
                <span>GST (5%):</span>
                <span>₹{(getCartTotal() * 0.05).toFixed(2)}</span>
              </div>
              <hr />
              <div className="d-flex justify-content-between mb-3">
                <strong>Total:</strong>
                <strong>₹{(getCartTotal() + 20 + (getCartTotal() * 0.05)).toFixed(2)}</strong>
              </div>
              
              <div className="d-grid gap-2">
                <Button variant="success" size="lg">
                  Proceed to Checkout
                </Button>
                <Button variant="outline-primary" onClick={() => navigate('/menu')}>
                  Continue Shopping
                </Button>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default Cart;

