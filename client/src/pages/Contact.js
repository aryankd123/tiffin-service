import React from 'react';
import { Container, Row, Col, Card, Button } from 'react-bootstrap';

function Contact() {
  return (
    <Container className="py-5">
      <Row className="justify-content-center mb-4">
        <Col md={8} className="text-center">
          <h1>Contact Us</h1>
          <p className="lead text-muted">
            Have a question, suggestion, or want to partner with us? We'd love to hear from you!
          </p>
        </Col>
      </Row>
      <Row className="justify-content-center">
        <Col md={6}>
          <Card className="shadow border-0">
            <Card.Body>
              <h5>Contact Details</h5>
              <p><strong>📞 Phone:</strong> +91 8210596213</p>
              <p><strong>📧 Email:</strong> info@tiffinexpress.com</p>
              <p><strong>📍 Address:</strong> 123, Main Street, Delhi NCR, India</p>
              <p><strong>🕐 Hours:</strong> Mon-Sat: 7 AM - 9 PM</p>
              <hr />
              <h6>Follow Us</h6>
              <p>
                <a href="https://instagram.com/" target="_blank" rel="noopener noreferrer">Instagram</a> |{' '}
                <a href="https://facebook.com/" target="_blank" rel="noopener noreferrer">Facebook</a> |{' '}
                <a href="https://twitter.com/" target="_blank" rel="noopener noreferrer">Twitter</a>
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default Contact;
