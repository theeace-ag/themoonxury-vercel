const { razorpay, generateTicketNumber, uuidv4 } = require('./_utils');
const db = require('./_store');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { name, email, phone, ticketType, amount } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const existing = await db.getRegistrationByEmail(email);
        if (existing && existing.payment_status === 'completed') {
            return res.status(400).json({ error: 'This email is already registered' });
        }

        // Handle Free Ticket
        if (amount == 0) {
            const ticketNumber = generateTicketNumber();
            const orderId = `FREE-${Date.now()}`;

            await db.createRegistration({
                ticketNumber,
                name,
                email,
                phone,
                ticketType,
                orderId,
                amount: 0,
                paymentStatus: 'completed'
            });

            // Generate QR and send email
            const qrData = JSON.stringify({ ticket: ticketNumber, name, event: 'MOONXURY 2025' });
            const qrCodeDataURL = await QRCode.toDataURL(qrData, { width: 200, margin: 2 });

            try {
                await sendTicketEmail({ ticket_number: ticketNumber, name, email, ticket_type: ticketType }, qrCodeDataURL);
            } catch (err) {
                console.error('Email error:', err);
            }

            return res.status(200).json({ success: true, ticketNumber, amount: 0 });
        }

        // Paid Ticket - Create Razorpay Order
        const order = await razorpay.orders.create({
            amount: amount * 100,
            currency: 'INR',
            receipt: uuidv4(),
            notes: { name, email, phone, ticketType }
        });

        const ticketNumber = generateTicketNumber();
        await db.createRegistration({
            ticketNumber,
            name,
            email,
            phone,
            ticketType,
            orderId: order.id,
            amount,
            paymentStatus: 'pending'
        });

        res.status(200).json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            ticketNumber
        });

    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
};

async function sendTicketEmail(registration, qrCodeDataURL) {
    const ticketHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff; border-radius: 20px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); padding: 40px; text-align: center;">
            <div style="font-size: 28px; color: #fff; letter-spacing: 8px;">THEMOON</div>
            <div style="font-size: 42px; font-weight: 700; color: #fff; margin: 20px 0;">MOONXURY</div>
        </div>
        <div style="padding: 40px;">
            <div style="background: #f8f8f8; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
                <div style="font-size: 12px; color: #888;">TICKET NUMBER</div>
                <div style="font-size: 24px; font-weight: 600;">${registration.ticket_number}</div>
            </div>
            <p><strong>Guest:</strong> ${registration.name}</p>
            <p><strong>Ticket Type:</strong> ${registration.ticket_type || 'Regular'}</p>
            <p><strong>Date:</strong> 25 February 2025</p>
            <p><strong>Time:</strong> 7 PM Onwards</p>
            <div style="text-align: center; margin-top: 20px;">
                <img src="${qrCodeDataURL}" alt="QR Code" style="width: 150px;">
            </div>
        </div>
    </div>`;

    await transporter.sendMail({
        from: `"THEMOON" <${process.env.EMAIL_USER}>`,
        to: registration.email,
        subject: `🎫 Your MOONXURY Ticket - ${registration.ticket_number}`,
        html: ticketHtml
    });
}
