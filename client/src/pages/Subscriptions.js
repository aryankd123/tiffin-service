import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Badge, Button, Spinner, Alert } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import API_BASE_URL from '../config/api';

function Subscriptions() {
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSubscriptionPlans();
    // eslint-disable-next-line
  }, []);

  const fetchSubscriptionPlans = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/subscriptions/plans`);
      setSubscriptionPlans(response.data.data || []);
      setError(null);
    } catch (err) {
      setError('Failed to load subscription plans. Please try again.');
      console.error('Error fetching subscription plans:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (plan) => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login to subscribe to a plan');
      navigate('/login');
      return;
    }
    try {
      // Calculate end date based on plan duration
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(startDate.getDate() + (plan.duration_days || 7));

      const subscriptionData = {
        plan_id: plan.id,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        delivery_address: "Default Address - Please update in dashboard"
      };

      await axios.post(`${API_BASE_URL}/api/subscriptions`, subscriptionData, {
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
      <Row className="mb-5">
        <Col className="text-center">
          <h1 className="display-4">Subscription Plans</h1>
          <p className="lead text-muted">
            Choose from our flexible tiffin plans and save money with regular deliveries
          </p>
        </Col>
      </Row>
      <Row>
        {subscriptionPlans.length === 0 ? (
          <Col className="text-center">
            <p className="text-muted">No subscription plans available at the moment.</p>
            <Button variant="outline-primary" onClick={fetchSubscriptionPlans}>
              Refresh
            </Button>
          </Col>
        ) : (
          subscriptionPlans.map(plan => (
            <Col md={6} lg={4} key={plan.id} className="mb-4">
              <Card className="h-100 shadow-sm border-0 position-relative">
                {plan.name.includes('Monthly') && (
                  <Badge bg="success" className="position-absolute top-0 start-50 translate-middle px-3 py-2">
                    Best Value
                  </Badge>
                )}
                {plan.name.includes('Weekly') && (
                  <Badge bg="primary" className="position-absolute top-0 start-50 translate-middle px-3 py-2">
                    Popular
                  </Badge>
                )}
                <Card.Body className="text-center p-4">
                  <Card.Title className="h4 mb-3">{plan.name}</Card.Title>
                  <div className="mb-3">
                    <span className="h2 text-primary">₹{parseFloat(plan.price).toFixed(0)}</span>
                    <small className="text-muted">
                      {plan.name.includes('Weekly') ? '/week' : 
                       plan.name.includes('Monthly') ? '/month' : 
                       plan.name.includes('Daily') ? '/day' : '/plan'}
                    </small>
                  </div>
                  <Card.Text className="text-muted mb-4">
                    {plan.description}
                  </Card.Text>
                  <div className="mb-4">
                    <small className="text-muted">
                      Duration: {plan.duration_days} day{plan.duration_days > 1 ? 's' : ''}
                    </small>
                  </div>
                  <Button 
                    variant={plan.name.includes('Monthly') ? 'success' : 
                            plan.name.includes('Weekly') ? 'primary' : 'outline-primary'} 
                    size="lg" 
                    className="w-100"
                    onClick={() => handleSubscribe(plan)}
                  >
                    Subscribe Now
                  </Button>
                  {plan.name.includes('Monthly') && (
                    <small className="text-success d-block mt-2">
                      💰 Save up to 20%
                    </small>
                  )}
                </Card.Body>
              </Card>
            </Col>
          ))
        )}
      </Row>
    </Container>
  );
}

export default Subscriptions;
