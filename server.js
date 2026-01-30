import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import * as brevo from '@getbrevo/brevo';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import db from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/asset', express.static('asset'));

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Email via Brevo (Sendinblue) API
const brevoClient = new brevo.TransactionalEmailsApi();
const brevoKey = process.env.BREVO_API_KEY || '';
if (brevoKey) {
    console.log('✅ Brevo API Key found (starts with: ' + brevoKey.substring(0, 8) + '...)');
    brevoClient.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, brevoKey);
} else {
    console.error('❌ BREVO_API_KEY NOT FOUND in environment variables');
}

// Generate Ticket Number
function generateTicketNumber() {
    const prefix = 'MXRY';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

// API Routes

// Register (Manual Payment Flow)
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, phone, ticketType, amount } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if already registered with completed payment
        const existing = await db.getRegistrationByEmail(email);
        if (existing && existing.payment_status === 'completed') {
            return res.status(400).json({ error: 'This email is already registered' });
        }

        const ticketNumber = generateTicketNumber();

        // Free tickets are auto-completed
        if (amount === 0) {
            await db.createRegistration({
                ticketNumber,
                name,
                email,
                phone,
                ticketType,
                orderId: `FREE-${Date.now()}`,
                amount: 0,
                paymentStatus: 'completed'
            });

            // Generate QR and send email for free tickets
            const qrData = JSON.stringify({
                ticket: ticketNumber,
                name,
                event: 'MOONXURY 2025',
                date: '25 Feb 2025'
            });
            const qrCodeDataURL = await QRCode.toDataURL(qrData, { width: 200, margin: 2 });
            const registration = { ticket_number: ticketNumber, name, email, phone, amount: 0, ticket_type: ticketType };

            try {
                await sendTicketEmail(registration, qrCodeDataURL);
                await sendAdminNotification(registration);
            } catch (err) {
                console.error('Email error:', err);
            }

            return res.json({ success: true, ticketNumber });
        }

        // Paid tickets saved as pending (manual verification)
        await db.createRegistration({
            ticketNumber,
            name,
            email,
            phone,
            ticketType,
            orderId: `MANUAL-${Date.now()}`,
            amount,
            paymentStatus: 'pending'
        });

        res.json({ success: true, ticketNumber });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Register Slot (Manual Payment Flow)
app.post('/api/register-slot', async (req, res) => {
    try {
        const { name, peopleCount, email, phone } = req.body;

        if (!name || !peopleCount || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Save slot booking as pending
        await db.createSlotBooking({
            name,
            peopleCount,
            email,
            phone,
            amount: 50,
            order_id: `SLOT-${Date.now()}`,
            payment_status: 'pending'
        });

        res.json({ success: true });

    } catch (error) {
        console.error('Slot registration error:', error);
        res.status(500).json({ error: 'Slot registration failed' });
    }
});

// Create Razorpay Order (Legacy - kept for compatibility)
app.post('/api/create-order', async (req, res) => {
    try {
        const { name, email, phone, ticketType, amount } = req.body;

        // Validate input
        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if already registered
        const existing = await db.getRegistrationByEmail(email);
        if (existing && existing.payment_status === 'completed') {
            return res.status(400).json({ error: 'This email is already registered' });
        }

        // Handle Free Ticket (0 Amount)
        if (amount == 0) {
            const ticketNumber = generateTicketNumber();
            const orderId = `FREE-${Date.now()}`;

            await db.createRegistration({
                ticketNumber,
                name,
                email,
                phone,
                ticketType,
                orderId: orderId,
                amount: 0,
                paymentStatus: 'completed'
            });

            // Generate QR and send email
            const qrData = JSON.stringify({
                ticket: ticketNumber,
                name: name,
                event: 'MOONXURY 2025',
                date: '25 Feb 2025'
            });
            const qrCodeDataURL = await QRCode.toDataURL(qrData, {
                width: 200,
                margin: 2
            });

            const registration = { ticket_number: ticketNumber, name, email, phone, amount: 0, ticket_type: ticketType };
            try {
                await sendTicketEmail(registration, qrCodeDataURL);
                await sendAdminNotification(registration);
            } catch (err) {
                console.error('Email error for free ticket:', err);
            }

            return res.json({
                success: true,
                ticketNumber,
                amount: 0
            });
        }

        // Create Razorpay order for paid tickets
        const order = await razorpay.orders.create({
            amount: amount * 100, // Amount in paise
            currency: 'INR',
            receipt: uuidv4(),
            notes: {
                name,
                email,
                phone,
                ticketType
            }
        });

        // Save registration to database
        const ticketNumber = generateTicketNumber();
        await db.createRegistration({
            ticketNumber,
            name,
            email,
            phone,
            ticketType,
            orderId: order.id,
            amount: amount,
            paymentStatus: 'pending'
        });

        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            ticketNumber // Return ticket number for reference
        });

    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Verify Payment
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }

        // Update registration
        const registration = await db.getRegistrationByOrderId(razorpay_order_id);
        if (!registration) {
            return res.status(404).json({ error: 'Registration not found' });
        }

        await db.updatePaymentStatus(razorpay_order_id, razorpay_payment_id, 'completed');

        // Generate QR Code
        const qrData = JSON.stringify({
            ticket: registration.ticket_number,
            name: registration.name,
            event: 'MOONXURY 2025',
            date: '25 Feb 2025'
        });
        const qrCodeDataURL = await QRCode.toDataURL(qrData, {
            width: 200,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        // Send confirmation email
        try {
            await sendTicketEmail(registration, qrCodeDataURL);
            await sendAdminNotification(registration);
        } catch (emailError) {
            console.error('Email error:', emailError);
        }

        res.json({
            success: true,
            ticketNumber: registration.ticket_number,
            message: 'Payment verified successfully'
        });

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ error: 'Payment verification failed' });
    }
});

// Get Ticket Details
app.get('/api/ticket/:ticketNumber', async (req, res) => {
    try {
        const registration = await db.getRegistrationByTicket(req.params.ticketNumber);
        if (!registration || registration.payment_status !== 'completed') {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const qrData = JSON.stringify({
            ticket: registration.ticket_number,
            name: registration.name,
            event: 'MOONXURY 2025',
            date: '25 Feb 2025'
        });
        const qrCodeDataURL = await QRCode.toDataURL(qrData, {
            width: 200,
            margin: 2
        });

        res.json({
            ticketNumber: registration.ticket_number,
            name: registration.name,
            email: registration.email,
            phone: registration.phone,
            qrCode: qrCodeDataURL,
            eventDate: '25 Feb 2025',
            eventTime: '7 PM Onwards',
            venue: 'Kolkata (Venue TBA)'
        });

    } catch (error) {
        console.error('Error fetching ticket:', error);
        res.status(500).json({ error: 'Failed to fetch ticket' });
    }
});

// Admin: Get all registrations
app.get('/api/admin/registrations', async (req, res) => {
    try {
        const registrations = await db.getAllRegistrations();
        const stats = await db.getStats();
        const slotBookings = await db.getAllSlotBookings();
        res.json({ registrations, stats, slotBookings });
    } catch (error) {
        console.error('Error fetching registrations:', error);
        res.status(500).json({ error: 'Failed to fetch registrations' });
    }
});

// Admin: Confirm payment and send ticket
app.post('/api/admin/confirm-payment', async (req, res) => {
    try {
        const { ticketNumber } = req.body;

        if (!ticketNumber) {
            return res.status(400).json({ error: 'Ticket number is required' });
        }

        const registration = await db.getRegistrationByTicket(ticketNumber);
        if (!registration) {
            return res.status(404).json({ error: 'Registration not found' });
        }

        if (registration.payment_status === 'completed') {
            return res.status(400).json({ error: 'Payment already confirmed' });
        }

        // Update status to completed
        await db.updatePaymentStatus(registration.order_id, 'MANUAL-CONFIRMED', 'completed');

        // Generate QR code
        const qrData = JSON.stringify({
            ticket: registration.ticket_number,
            name: registration.name,
            event: 'MOONXURY 2025',
            date: '25 Feb 2025'
        });
        const qrCodeDataURL = await QRCode.toDataURL(qrData, { width: 200, margin: 2 });

        // Send ticket email
        const regData = {
            ticket_number: registration.ticket_number,
            name: registration.name,
            email: registration.email,
            phone: registration.phone,
            amount: registration.amount,
            ticket_type: registration.ticket_type
        };

        try {
            console.log('Sending ticket email to:', regData.email);
            await sendTicketEmail(regData, qrCodeDataURL);
            console.log('✅ Ticket email sent successfully to:', regData.email);

            await sendAdminNotification(regData);
            console.log('✅ Admin notification sent');
        } catch (emailErr) {
            console.error('❌ Email error:', emailErr.message);
            console.error('Full error:', emailErr);
            // Still return success since payment was confirmed
            return res.json({ success: true, message: 'Payment confirmed but email failed: ' + emailErr.message });
        }

        res.json({ success: true, message: 'Payment confirmed and ticket sent' });

    } catch (error) {
        console.error('Confirm payment error:', error);
        res.status(500).json({ error: 'Failed to confirm payment' });
    }
});

// Admin: Confirm slot booking
app.post('/api/admin/confirm-slot', async (req, res) => {
    try {
        const { slotId } = req.body;

        if (!slotId) {
            return res.status(400).json({ error: 'Slot ID is required' });
        }

        const result = await db.confirmSlotBooking(slotId);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Slot booking not found' });
        }

        // Send confirmation email
        const booking = result.booking;
        try {
            await sendSlotConfirmationEmail(booking);
        } catch (emailErr) {
            console.error('Email error:', emailErr);
        }

        res.json({ success: true, message: 'Slot confirmed' });

    } catch (error) {
        console.error('Confirm slot error:', error);
        res.status(500).json({ error: 'Failed to confirm slot' });
    }
});

// Send ticket email
async function sendTicketEmail(registration, qrCodeDataURL) {
    const ticketHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .ticket-container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); padding: 40px; text-align: center; }
            .logo { font-size: 28px; font-weight: 300; color: #fff; letter-spacing: 8px; margin-bottom: 10px; }
            .event-name { font-size: 42px; font-weight: 700; color: #fff; letter-spacing: 4px; margin: 20px 0; }
            .featuring { color: #888; font-size: 14px; letter-spacing: 3px; }
            .dj-name { color: #fff; font-size: 18px; margin-top: 10px; }
            .content { padding: 40px; }
            .ticket-number { background: #f8f8f8; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 30px; }
            .ticket-label { font-size: 12px; color: #888; letter-spacing: 2px; margin-bottom: 5px; }
            .ticket-value { font-size: 24px; font-weight: 600; color: #1a1a1a; letter-spacing: 3px; }
            .details { margin-bottom: 30px; }
            .detail-row { display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #eee; }
            .detail-label { color: #888; font-size: 14px; }
            .detail-value { font-weight: 500; color: #1a1a1a; }
            .qr-section { text-align: center; padding: 20px; background: #f8f8f8; border-radius: 10px; }
            .qr-code { width: 150px; height: 150px; }
            .footer { text-align: center; padding: 30px; background: #1a1a1a; color: #fff; }
            .footer-text { font-size: 12px; color: #888; }
        </style>
    </head>
    <body>
        <div class="ticket-container">
            <div class="header">
                <div class="logo">THEMOON</div>
                <div class="event-name">MOONXURY</div>
                <div class="featuring">FEATURING</div>
                <div class="dj-name">DJ RD RAJAT</div>
            </div>
            <div class="content">
                <div class="ticket-number">
                    <div class="ticket-label">TICKET NUMBER</div>
                    <div class="ticket-value">${registration.ticket_number}</div>
                </div>
                <div class="details">
                    <div class="detail-row">
                        <span class="detail-label">GUEST NAME</span>
                        <span class="detail-value">${registration.name}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">DATE</span>
                        <span class="detail-value">25 February 2025</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">TIME</span>
                        <span class="detail-value">7 PM Onwards</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">VENUE</span>
                        <span class="detail-value">Kolkata (TBA)</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">TICKET TYPE</span>
                        <span class="detail-value">${registration.ticket_type || 'Regular'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">ENTRY</span>
                        <span class="detail-value">18+ Only</span>
                    </div>
                </div>
                <div class="qr-section">
                    <img src="${qrCodeDataURL}" class="qr-code" alt="QR Code">
                    <p style="font-size: 12px; color: #888; margin-top: 10px;">Scan for verification</p>
                </div>
            </div>
            <div class="footer">
                <p style="margin: 0; font-size: 14px;">Female Edition Launch × DJ Night</p>
                <p class="footer-text">For queries: +91 70032 50233</p>
            </div>
        </div>
    </body>
    </html>
    `;

    console.log(`Attempting to send ticket email to: ${registration.email}`);
    try {
        const sendSmtpEmail = new brevo.SendSmtpEmail();
        sendSmtpEmail.sender = { name: 'MOONXURY', email: process.env.EMAIL_USER };
        sendSmtpEmail.to = [{ email: registration.email, name: registration.name }];
        sendSmtpEmail.subject = `🎫 Your MOONXURY Ticket - ${registration.ticket_number}`;
        sendSmtpEmail.htmlContent = ticketHtml;

        await brevoClient.sendTransacEmail(sendSmtpEmail);
        console.log(`✅ Ticket email sent successfully to: ${registration.email}`);
    } catch (error) {
        console.error(`Failed to send ticket email to ${registration.email}:`, error);
        throw error;
    }
}

// Send admin notification
async function sendAdminNotification(registration) {
    const adminHtml = `
    <h2>🎉 New Ticket Sold!</h2>
    <p><strong>Ticket Number:</strong> ${registration.ticket_number}</p>
    <p><strong>Ticket Type:</strong> ${registration.ticket_type || 'Regular'}</p>
    <p><strong>Name:</strong> ${registration.name}</p>
    <p><strong>Email:</strong> ${registration.email}</p>
    <p><strong>Phone:</strong> ${registration.phone}</p>
    <p><strong>Amount:</strong> ₹${registration.amount}</p>
    <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
    `;
    try {
        const sendSmtpEmail = new brevo.SendSmtpEmail();
        sendSmtpEmail.sender = { name: 'MOONXURY System', email: process.env.EMAIL_USER };
        sendSmtpEmail.to = [{ email: process.env.ADMIN_EMAIL }];
        sendSmtpEmail.subject = `🎫 Ticket Sold: ${registration.ticket_number} (${registration.ticket_type || 'Regular'})`;
        sendSmtpEmail.htmlContent = adminHtml;

        await brevoClient.sendTransacEmail(sendSmtpEmail);
        console.log('✅ Admin notification sent');
    } catch (error) {
        console.error('Admin notification error:', error);
    }
}

// Send slot confirmation email
async function sendSlotConfirmationEmail(booking) {
    const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px; }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: 700; letter-spacing: 4px; }
            h1 { color: #333; font-size: 28px; margin-bottom: 10px; }
            .success { color: #22C55E; font-size: 48px; }
            .details { background: #f8f8f8; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .details p { margin: 8px 0; }
            .cta { text-align: center; margin-top: 30px; }
            .btn { display: inline-block; background: #1a1a1a; color: #fff; padding: 15px 30px; text-decoration: none; border-radius: 8px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">MOONXURY</div>
            </div>
            <div style="text-align: center;">
                <div class="success">✓</div>
                <h1>Slot Confirmed!</h1>
                <p>Your slot for MOONXURY 2025 has been confirmed.</p>
            </div>
            <div class="details">
                <p><strong>Name:</strong> ${booking.name}</p>
                <p><strong>People:</strong> ${booking.peopleCount || 1}</p>
                <p><strong>Email:</strong> ${booking.email}</p>
                <p><strong>Phone:</strong> ${booking.phone}</p>
                <p><strong>Amount Paid:</strong> ₹${booking.amount || 50}</p>
            </div>
            <div class="cta">
                <p>You can now book your tickets!</p>
                <a href="${process.env.SITE_URL || 'https://moonxury-production-47fa.up.railway.app'}" class="btn">BOOK TICKETS</a>
            </div>
        </div>
    </body>
    </html>
    `;

    console.log(`Attempting to send slot confirmation to: ${booking.email}`);
    try {
        const sendSmtpEmail = new brevo.SendSmtpEmail();
        sendSmtpEmail.sender = { name: 'MOONXURY', email: process.env.EMAIL_USER };
        sendSmtpEmail.to = [{ email: booking.email, name: booking.name }];
        sendSmtpEmail.subject = `✅ Slot Confirmed - MOONXURY 2025`;
        sendSmtpEmail.htmlContent = emailHtml;

        await brevoClient.sendTransacEmail(sendSmtpEmail);
        console.log(`✅ Slot confirmation sent successfully to: ${booking.email}`);
    } catch (error) {
        console.error(`Failed to send slot confirmation to ${booking.email}:`, error);
        throw error;
    }
}

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/ticket/:ticketNumber', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ticket.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Legal Pages
app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});
app.get('/shipping', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'shipping.html'));
});
app.get('/refund', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'refund.html'));
});
app.get('/contact', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

// Serve Register Page
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Create Slot Booking
app.post('/api/create-slot-booking', async (req, res) => {
    try {
        const { name, peopleCount, email, phone } = req.body;

        if (!name || !peopleCount || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const amount = 50; // Fixed fee for slot confirmation

        const order = await razorpay.orders.create({
            amount: amount * 100, // paise
            currency: 'INR',
            receipt: uuidv4(),
            notes: { name, email, phone, type: 'slot_booking' }
        });

        await db.createSlotBooking({
            name,
            peopleCount,
            email,
            phone,
            amount: amount,
            orderId: order.id,
            paymentStatus: 'pending'
        });

        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Slot booking error:', error);
        res.status(500).json({ error: 'Failed to initiate booking' });
    }
});

// Verify Slot Payment
app.post('/api/verify-slot-payment', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid signature' });
        }

        const booking = await db.getSlotBookingByOrderId(razorpay_order_id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });

        await db.updateSlotPaymentStatus(razorpay_order_id, razorpay_payment_id, 'completed');

        await sendSlotConfirmationEmail(booking);

        res.json({ success: true });
    } catch (error) {
        console.error('Slot verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🌙 MOONXURY Server running on http://localhost:${PORT}`);
    console.log(`📋 Admin panel: http://localhost:${PORT}/admin`);
});
