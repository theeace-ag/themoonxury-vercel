const crypto = require('crypto');
const db = require('./_store');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendTicketEmail(registration, qrCodeDataURL) {
    const ticketHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .ticket-container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 20px; overflow: hidden; }
            .header { background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); padding: 40px; text-align: center; }
            .logo { font-size: 28px; color: #fff; letter-spacing: 8px; }
            .event-name { font-size: 42px; font-weight: 700; color: #fff; margin: 20px 0; }
            .content { padding: 40px; }
            .ticket-number { background: #f8f8f8; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 30px; }
            .ticket-label { font-size: 12px; color: #888; }
            .ticket-value { font-size: 24px; font-weight: 600; }
            .detail-row { padding: 15px 0; border-bottom: 1px solid #eee; }
            .qr-section { text-align: center; padding: 20px; background: #f8f8f8; border-radius: 10px; }
            .footer { text-align: center; padding: 30px; background: #1a1a1a; color: #fff; }
        </style>
    </head>
    <body>
        <div class="ticket-container">
            <div class="header">
                <div class="logo">THEMOON</div>
                <div class="event-name">MOONXURY</div>
            </div>
            <div class="content">
                <div class="ticket-number">
                    <div class="ticket-label">TICKET NUMBER</div>
                    <div class="ticket-value">${registration.ticket_number}</div>
                </div>
                <div class="detail-row"><strong>Guest:</strong> ${registration.name}</div>
                <div class="detail-row"><strong>Ticket Type:</strong> ${registration.ticket_type || 'Regular'}</div>
                <div class="detail-row"><strong>Date:</strong> 25 February 2025</div>
                <div class="detail-row"><strong>Time:</strong> 7 PM Onwards</div>
                <div class="detail-row"><strong>Venue:</strong> Kolkata (TBA)</div>
                <div class="qr-section">
                    <img src="${qrCodeDataURL}" alt="QR Code" style="width: 150px;">
                    <p style="font-size: 12px; color: #888;">Scan for verification</p>
                </div>
            </div>
            <div class="footer">
                <p>Female Edition Launch × DJ Night</p>
                <p style="font-size: 12px; color: #888;">For queries: +91 70032 50233</p>
            </div>
        </div>
    </body>
    </html>
    `;

    await transporter.sendMail({
        from: `"THEMOON" <${process.env.EMAIL_USER}>`,
        to: registration.email,
        subject: `🎫 Your MOONXURY Ticket - ${registration.ticket_number}`,
        html: ticketHtml
    });
}

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

    await transporter.sendMail({
        from: `"MOONXURY System" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `🎫 Ticket Sold: ${registration.ticket_number} (${registration.ticket_type || 'Regular'})`,
        html: adminHtml
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }

        const registration = await db.getRegistrationByOrderId(razorpay_order_id);
        if (!registration) {
            return res.status(404).json({ error: 'Registration not found' });
        }

        await db.updatePaymentStatus(razorpay_order_id, razorpay_payment_id, 'completed');

        const qrData = JSON.stringify({
            ticket: registration.ticket_number,
            name: registration.name,
            event: 'MOONXURY 2025'
        });
        const qrCodeDataURL = await QRCode.toDataURL(qrData, { width: 200, margin: 2 });

        try {
            await sendTicketEmail(registration, qrCodeDataURL);
            await sendAdminNotification(registration);
        } catch (emailError) {
            console.error('Email error:', emailError);
        }

        res.status(200).json({
            success: true,
            ticketNumber: registration.ticket_number,
            message: 'Payment verified successfully'
        });

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ error: 'Payment verification failed' });
    }
};
