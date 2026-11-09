import React from 'react';
import { Container, Row, Col } from 'react-bootstrap';

function Footer() {
  return (
    <footer className="bg-dark text-light py-4 mt-5">
      <Container>
        <Row>
          <Col md={6}>
            <h5>🍛 TiffinExpress</h5>
            <p>Fresh, homemade Indian meals delivered to your doorstep</p>
            <p className="text-muted">घर जैसा खाना, रोज़ाना डिलीवरी</p>
          </Col>
          <Col md={3}>
            <h6>Quick Links</h6>
            <ul className="list-unstyled">
              <li><a href="/menu" className="text-light">Menu</a></li>
              <li><a href="/subscriptions" className="text-light">Subscription Plans</a></li>
              <li><a href="/contact" className="text-light">Contact Us</a></li>
            </ul>
          </Col>
          <Col md={3}>
            <h6>Contact Info</h6>
            <p>📞 +91 8210596213</p>
            <p>📧 info@tiffinexpress.com</p>
            <p>📍 Patna Bihar</p>
            <p>🕐 Mon-Sat: 7 AM - 9 PM</p>
          </Col>
        </Row>
        <hr />
        <Row>
          <Col className="text-center">
            <p>&copy; 2025 TiffinExpress. All rights reserved. | Made with ❤️ in India</p>
          </Col>
        </Row>
      </Container>
    </footer>
  );
}

export default Footer;
