import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Badge, Alert, Tabs, Tab, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';


function Dashboard() {
  const [user, setUser] = useState(null);
  const [userSubscriptions, setUserSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState(null);

  
  const handleViewDetails = (subscription) => {
    setSelectedSubscription(subscription);
    setShowModal(true);
  };

  
  const handlePauseSubscription = async (subscription) => {
    const token = localStorage.getItem('token');
    try {
      await axios.patch(
        `http://localhost:3001/api/subscriptions/${subscription.id}/status`,
        { status: 'paused' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert('Subscription paused!');
      // Refresh subscriptions
      fetchUserSubscriptions();
    } catch (error) {
      alert('Failed to pause subscription.');
      console.error(error);
    }
  };
  
  useEffect(() => {
    // Check if user is logged in
    const userData = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    
    if (!userData || !token) {
      navigate('/login');
      return;
    }
    
    setUser(JSON.parse(userData));
    fetchUserSubscriptions();
  }, [navigate]);

  const fetchUserSubscriptions = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('http://localhost:3001/api/subscriptions/my-subscriptions', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUserSubscriptions(response.data.data);
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <Container className="py-5">
        <Alert variant="warning">
          Please log in to access your dashboard.
          <Button variant="outline-warning" className="ms-3" onClick={() => navigate('/login')}>
            Login
          </Button>
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      {/* Welcome Section */}
      <Row className="mb-4">
        <Col>
          <div className="bg-primary text-white p-4 rounded">
            <h2>Welcome back, {user.name}! 👋</h2>
            <p className="mb-0">Manage your tiffin subscriptions and orders</p>
          </div>
        </Col>
      </Row>

      {/* Dashboard Tabs */}
      <Tabs defaultActiveKey="subscriptions" className="mb-4">
        {/* Subscriptions Tab */}
        <Tab eventKey="subscriptions" title="My Subscriptions">
          <Row>
            {userSubscriptions.length === 0 ? (
              <Col>
                <Card className="text-center p-4">
                  <Card.Body>
                    <div style={{ fontSize: '60px' }}>📋</div>
                    <h5>No Active Subscriptions</h5>
                    <p className="text-muted">Start your healthy eating journey today!</p>
                    <Button variant="primary" onClick={() => navigate('/subscriptions')}>
                      Browse Subscription Plans
                    </Button>
                  </Card.Body>
                </Card>
              </Col>
            ) : (
              userSubscriptions.map(subscription => (
                <Col md={6} lg={4} key={subscription.id} className="mb-4">
                  <Card className="h-100">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <Card.Title className="h6">{subscription.plan_name}</Card.Title>
                        <Badge bg={subscription.status === 'active' ? 'success' : 'secondary'}>
                          {subscription.status}
                        </Badge>
                      </div>
                      
                      <Card.Text className="text-muted small">
                        {subscription.plan_description}
                      </Card.Text>
                      
                      <div className="mb-2">
                        <strong>₹{subscription.plan_price}</strong>
                        <small className="text-muted"> /plan</small>
                      </div>
                      
                      <div className="mb-3">
                        <small className="text-muted">
                          {new Date(subscription.start_date).toLocaleDateString()} - {new Date(subscription.end_date).toLocaleDateString()}
                        </small>
                      </div>
                      
                      <div className="d-grid gap-2">
                      <Button 
                        variant="outline-primary" 
                          size="sm"
                         onClick={() => handleViewDetails(subscription)}
                        >
                        View Details
                          </Button>
                            {subscription.status === 'active' && (
                          <Button 
                            variant="outline-warning" 
                            size="sm"
                          onClick={() => handlePauseSubscription(subscription)}
                          >
                     Pause Subscription
                    </Button>
                          )}

                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              ))
            )}
          </Row>
        </Tab>

        {/* Profile Tab */}
        <Tab eventKey="profile" title="Profile">
          <Row>
            <Col md={6}>
              <Card>
                <Card.Header>
                  <h5>Profile Information</h5>
                </Card.Header>
                <Card.Body>
                  <div className="mb-3">
                    <strong>Name:</strong> {user.name}
                  </div>
                  <div className="mb-3">
                    <strong>Email:</strong> {user.email}
                  </div>
                  <div className="mb-3">
                    <strong>Member Since:</strong> {new Date().toLocaleDateString()}
                  </div>
                  <Button variant="outline-primary">Edit Profile</Button>
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={6}>
              <Card>
                <Card.Header>
                  <h5>Delivery Addresses</h5>
                </Card.Header>
                <Card.Body>
                  <p className="text-muted">No delivery addresses added yet.</p>
                  <Button variant="primary">Add Address</Button>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Tab>

        {/* Orders Tab */}
        <Tab eventKey="orders" title="Order History">
          <Card className="text-center p-4">
            <Card.Body>
              <div style={{ fontSize: '60px' }}>🍽️</div>
              <h5>No Orders Yet</h5>
              <p className="text-muted">Your order history will appear here</p>
              <Button variant="primary" onClick={() => navigate('/menu')}>
                Order Now
              </Button>
            </Card.Body>
          </Card>
        </Tab>
      </Tabs>
      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
  <Modal.Header closeButton>
    <Modal.Title>Subscription Details</Modal.Title>
  </Modal.Header>
  <Modal.Body>
    {selectedSubscription && (
      <div>
        <p><strong>Plan:</strong> {selectedSubscription.plan_name}</p>
        <p><strong>Description:</strong> {selectedSubscription.plan_description}</p>
        <p><strong>Price:</strong> ₹{selectedSubscription.plan_price}</p>
        <p><strong>Start Date:</strong> {selectedSubscription.start_date}</p>
        <p><strong>End Date:</strong> {selectedSubscription.end_date}</p>
        <p><strong>Status:</strong> {selectedSubscription.status}</p>
        {/* Add more details if needed */}
      </div>
    )}
  </Modal.Body>
  <Modal.Footer>
    <Button variant="secondary" onClick={() => setShowModal(false)}>
      Close
    </Button>
  </Modal.Footer>
</Modal>

    </Container>
  );
}

export default Dashboard;
