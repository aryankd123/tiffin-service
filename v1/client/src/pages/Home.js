import React from 'react';
import { Container, Row, Col, Card, Button } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';

function Home() {
  const navigate = useNavigate();

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-primary text-white py-5">
        <Container>
          <Row className="align-items-center">
            <Col lg={6}>
              <h1 className="display-4 fw-bold">
                Ghar Jaisa Khana, Daily Delivered
              </h1>
              <p className="lead">
                स्वादिष्ट घर का खाना रोज़ाना आपके दरवाज़े तक। Choose from our variety of 
                Indian tiffin plans - Veg, Non-Veg, and Jain options available.
              </p>
              <div className="mt-4">
                <Button 
                  variant="light" 
                  size="lg" 
                  as={Link} 
                  to="/menu" 
                  className="me-3"
                >
                  View Menu
                </Button>
                <Button 
                  variant="outline-light" 
                  size="lg" 
                  as={Link} 
                  to="/subscriptions"
                >
                  Subscribe Now - ₹60/day
                </Button>
              </div>
            </Col>
            <Col lg={6}>
              <div className="text-center">
                <div style={{ fontSize: '200px' }}>🍛</div>
                <p className="mt-2">Dal • Sabzi • Roti • Chawal</p>
              </div>
            </Col>
          </Row>
        </Container>
      </section>

      {/* Features Section */}
      <section className="py-5">
        <Container>
          <Row className="text-center mb-5">
            <Col>
              <h2>Why Choose TiffinExpress?</h2>
              <p className="text-muted">हम सिर्फ खाना नहीं, खुशियाँ भी पहुंचाते हैं</p>
            </Col>
          </Row>
          
          <Row>
            <Col md={4} className="mb-4">
              <Card className="h-100 text-center border-0 shadow-sm">
                <Card.Body>
                  <div style={{ fontSize: '60px' }}>🏠</div>
                  <Card.Title>Ghar Jaisa Quality</Card.Title>
                  <Card.Text>
                    Fresh ingredients और traditional Indian recipes के साथ बना हुआ खाना, 
                    बिल्कुल घर जैसा स्वाद।
                  </Card.Text>
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={4} className="mb-4">
              <Card className="h-100 text-center border-0 shadow-sm">
                <Card.Body>
                  <div style={{ fontSize: '60px' }}>🛵</div>
                  <Card.Title>Daily Delivery</Card.Title>
                  <Card.Text>
                    Monday to Saturday तक fresh tiffin delivery। 
                    Weekly और monthly plans available हैं।
                  </Card.Text>
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={4} className="mb-4">
              <Card className="h-100 text-center border-0 shadow-sm">
                <Card.Body>
                  <div style={{ fontSize: '60px' }}>₹</div>
                  <Card.Title>Affordable Pricing</Card.Title>
                  <Card.Text>
                    Starting from ₹60/day। Restaurant quality food at 
                    pocket-friendly prices। Subscription plans में और भी savings।
                  </Card.Text>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </section>

      {/* Popular Tiffin Options */}
      <section className="py-5 bg-light">
        <Container>
          <Row className="text-center mb-5">
            <Col>
              <h2>Popular Tiffin Options</h2>
              <p className="text-muted">Choose from our variety of Indian meal plans</p>
            </Col>
          </Row>
          
          <Row>
            <Col md={4} className="mb-4">
              <Card className="h-100 shadow-sm">
                <Card.Body className="text-center">
                  <div style={{ fontSize: '50px' }}>🥗</div>
                  <Card.Title className="text-success">Veg Tiffin</Card.Title>
                  <Card.Text>
                    <strong>₹60/day</strong><br/>
                    Dal + Sabzi + 4 Roti + Rice + Pickle
                  </Card.Text>
                  <Button 
                    variant="success" 
                    size="sm"
                    onClick={() => navigate('/subscriptions')}
                  >
                    Order Now
                  </Button>
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={4} className="mb-4">
              <Card className="h-100 shadow-sm">
                <Card.Body className="text-center">
                  <div style={{ fontSize: '50px' }}>🍗</div>
                  <Card.Title className="text-danger">Non-Veg Tiffin</Card.Title>
                  <Card.Text>
                    <strong>₹90/day</strong><br/>
                    Chicken/Fish Curry + Dal + 4 Roti + Rice
                  </Card.Text>
                  <Button 
                    variant="danger" 
                    size="sm"
                    onClick={() => navigate('/subscriptions')}
                  >
                    Order Now
                  </Button>
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={4} className="mb-4">
              <Card className="h-100 shadow-sm">
                <Card.Body className="text-center">
                  <div style={{ fontSize: '50px' }}>🌿</div>
                  <Card.Title className="text-warning">Jain Tiffin</Card.Title>
                  <Card.Text>
                    <strong>₹70/day</strong><br/>
                    No Onion/Garlic + Pure Veg + Traditional Recipes
                  </Card.Text>
                  <Button 
                    variant="warning" 
                    size="sm"
                    onClick={() => navigate('/subscriptions')}
                  >
                    Order Now
                  </Button>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </section>
    </div>
  );
}

export default Home;
