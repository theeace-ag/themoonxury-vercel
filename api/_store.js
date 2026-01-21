// In-memory store for Vercel serverless
// WARNING: Data resets on cold starts. For production, use a persistent database.

const registrations = new Map();
const slotBookings = new Map();

module.exports = {
    // --- Registration Methods ---
    createRegistration: async (data) => {
        const { ticketNumber, name, email, phone, orderId, amount, paymentStatus, ticketType } = data;
        const registration = {
            id: registrations.size + 1,
            ticket_number: ticketNumber,
            name,
            email,
            phone,
            ticket_type: ticketType || 'Regular',
            order_id: orderId,
            payment_id: null,
            amount,
            payment_status: paymentStatus,
            created_at: new Date().toISOString()
        };
        registrations.set(orderId, registration);
        return { id: registration.id, ticketNumber };
    },

    updatePaymentStatus: async (orderId, paymentId, status) => {
        const registration = registrations.get(orderId);
        if (registration) {
            registration.payment_id = paymentId;
            registration.payment_status = status;
            registrations.set(orderId, registration);
        }
        return { changes: registration ? 1 : 0 };
    },

    getRegistrationByEmail: async (email) => {
        for (const reg of registrations.values()) {
            if (reg.email === email && reg.payment_status === 'completed') return reg;
        }
        return null;
    },

    getRegistrationByOrderId: async (orderId) => {
        return registrations.get(orderId) || null;
    },

    getRegistrationByTicket: async (ticketNumber) => {
        for (const reg of registrations.values()) {
            if (reg.ticket_number === ticketNumber) return reg;
        }
        return null;
    },

    getAllRegistrations: async () => {
        return Array.from(registrations.values()).sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );
    },

    getStats: async () => {
        const all = Array.from(registrations.values());
        const slots = Array.from(slotBookings.values());
        return {
            total: all.length,
            completed: all.filter(r => r.payment_status === 'completed').length,
            pending: all.filter(r => r.payment_status === 'pending').length,
            revenue: all.filter(r => r.payment_status === 'completed').reduce((sum, r) => sum + r.amount, 0),
            slots_confirmed: slots.filter(s => s.payment_status === 'completed').length
        };
    },

    // --- Slot Booking Methods ---
    createSlotBooking: async (data) => {
        const booking = {
            id: slotBookings.size + 1,
            ...data,
            payment_id: null,
            payment_status: data.paymentStatus || 'pending',
            created_at: new Date().toISOString()
        };
        slotBookings.set(data.orderId, booking);
        return booking;
    },

    getSlotBookingByOrderId: async (orderId) => {
        return slotBookings.get(orderId) || null;
    },

    updateSlotPaymentStatus: async (orderId, paymentId, status) => {
        const booking = slotBookings.get(orderId);
        if (booking) {
            booking.payment_id = paymentId;
            booking.payment_status = status;
            slotBookings.set(orderId, booking);
        }
        return { changes: booking ? 1 : 0 };
    }
};
