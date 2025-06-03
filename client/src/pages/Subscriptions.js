import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Badge, Button, Spinner, Alert } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom'; // Add this import
import axios from 'axios';

function Subscriptions() {
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate(); // Add this hook

  // Fetch subscription plans from your backend
  useEffect(() => {
    fetchSubscriptionPlans();
  }, []);

  const fetchSubscriptionPlans = async () => {
    try {
      setLoading(true);
      const response = await axios.get('http://localhost:3001/api/subscriptions/plans');
      setSubscriptionPlans(response.data.data);
      setError(null);
    } catch (err) {
      setError('Failed to load subscription plans. Please try again.');
      console.error('Error fetching subscription plans:', err);
    } finally {
      setLoading(false);
    }
  };

  // ADD THIS FUNCTION - Handle subscription creation
  const handleSubscribe = async (plan) => {
    const token = localStorage.getItem('token');
    
    if (!token) {
      alert('Please login to subscribe to a plan');
      navigate('/login');
      return;
    }

    try {
      // Calculate end date based on plan type
      const startDate = new Date();
      const endDate = new Date();
      
      if (plan.name.includes('Weekly')) {
        endDate.setDate(startDate.getDate() + 7);
      } else if (plan.name.includes('Monthly')) {
        endDate.setDate(startDate.getDate() + 30);
      } else {
        endDate.setDate(startDate.getDate() + 7); // Default to weekly
      }

      const subscriptionData = {
        plan_id: plan.id,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        delivery_address: "Default Address - Please update in dashboard"
      };

      const response = await axios.post('http://localhost:3001/api/subscriptions', subscriptionData, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert(`Successfully subscribed to ${plan.name}! 🎉`);
      navigate('/dashboard');
      
    } catch (error) {
      console.error('Subscription error:', error);
      alert('Failed to create subscription. Please try again.');
    }
  };

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3">Loading subscription plans...</p>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="py-5">
        <Alert variant="danger">
          {error}
          <Button variant="outline-danger" className="ms-3" onClick={fetchSubscriptionPlans}>
            Try Again
          </Button>
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      {/* Page Header */}
      <Row className="mb-5">
        <Col className="text-center">
          <h1 className="display-4">Subscription Plans</h1>
          <p className="lead text-muted">
            Choose from our flexible tiffin plans और save money with regular deliveries
          </p>
        </Col>
      </Row>

      {/* Subscription Plans */}
      <Row>
        {subscriptionPlans.length === 0 ? (
          <Col className="text-center">
            <p className="text-muted">No subscription plans available at the moment.</p>
          </Col>
        ) : (
          subscriptionPlans.map(plan => (
            <Col md={6} lg={4} key={plan.id} className="mb-4">
              <Card className="h-100 shadow-sm border-0 position-relative">
                {plan.name.includes('Weekly') && (
                  <Badge bg="success" className="position-absolute top-0 start-50 translate-middle px-3 py-2">
                    Popular
                  </Badge>
                )}
                
                <Card.Body className="text-center p-4">
                  <div className="mb-3">
                    {plan.is_vegetarian ? (
                      <div style={{ fontSize: '60px' }}>🌿</div>
                    ) : (
                      <div style={{ fontSize: '60px' }}>🍗</div>
                    )}
                  </div>
                  
                  <Card.Title className="h4 mb-3">{plan.name}</Card.Title>
                  
                  <div className="mb-3">
                    <span className="h2 text-primary">₹{plan.price}</span>
                    <small className="text-muted">
                      {plan.name.includes('Weekly') ? '/week' : 
                       plan.name.includes('Monthly') ? '/month' : 
                       '/plan'}
                    </small>
                  </div>
                  
                  <Card.Text className="text-muted mb-4">
                    {plan.description}
                  </Card.Text>
                  
                  <div className="mb-4">
                    <h6>Delivery Days:</h6>
                    <div className="d-flex flex-wrap justify-content-center gap-1">
                      {plan.days_of_week.map(day => (
                        <Badge key={day} bg="outline-primary" className="text-primary border border-primary">
                          {day.substring(0, 3)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    {plan.is_vegetarian ? (
                      <Badge bg="success" className="me-2">🌿 Pure Vegetarian</Badge>
                    ) : (
                      <Badge bg="danger" className="me-2">🍗 Non-Vegetarian</Badge>
                    )}
                  </div>
                  
                  {/* UPDATE THIS BUTTON - Add onClick handler */}
                  <Button 
                    variant={plan.name.includes('Weekly') ? 'success' : 'primary'} 
                    size="lg" 
                    className="w-100"
                    onClick={() => handleSubscribe(plan)}
                  >
                    Subscribe Now
                  </Button>
                </Card.Body>
              </Card>
            </Col>
          ))
        )}
      </Row>

      {/* Benefits Section */}
      <Row className="mt-5">
        <Col>
          <div className="bg-light p-4 rounded">
            <h4 className="text-center mb-4">Why Subscribe?</h4>
            <Row>
              <Col md={4} className="text-center mb-3">
                <div style={{ fontSize: '40px' }}>💰</div>
                <h6>Save Money</h6>
                <p className="text-muted">Up to 20% savings compared to daily orders</p>
              </Col>
              <Col md={4} className="text-center mb-3">
                <div style={{ fontSize: '40px' }}>📅</div>
                <h6>Convenience</h6>
                <p className="text-muted">No daily ordering hassle, automatic delivery</p>
              </Col>
              <Col md={4} className="text-center mb-3">
                <div style={{ fontSize: '40px' }}>🎯</div>
                <h6>Flexibility</h6>
                <p className="text-muted">Pause, modify, or cancel anytime</p>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>
    </Container>
  );
}

export default Subscriptions;
