// MOONXURY - Manual Payment Flow
document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initForm();
    initModals();
    updatePriceDisplay();
});

// Particle Animation
function initParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    const particleCount = 30;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.animationDelay = `${Math.random() * 15}s`;
        particle.style.animationDuration = `${15 + Math.random() * 10}s`;
        container.appendChild(particle);
    }
}

// Global state
let currentRegistration = null;

// Price display
function updatePriceDisplay() {
    const ticketType = document.getElementById('ticketType');
    const displayAmount = document.getElementById('displayAmount');

    if (!ticketType || !displayAmount) return;

    const updatePrice = () => {
        const selected = ticketType.options[ticketType.selectedIndex];
        const price = selected.getAttribute('data-price');
        displayAmount.textContent = price;
    };

    ticketType.addEventListener('change', updatePrice);
    updatePrice();
}

// Form Handling
function initForm() {
    const form = document.getElementById('registrationForm');
    const loadingOverlay = document.getElementById('loadingOverlay');

    if (!form) return;

    // Phone input validation
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
        });
    }

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const ticketTypeEl = document.getElementById('ticketType');
        const ticketType = ticketTypeEl.value;
        const amount = parseInt(ticketTypeEl.options[ticketTypeEl.selectedIndex].getAttribute('data-price'));

        if (!name || !email || !phone) {
            alert('Please fill in all fields');
            return;
        }

        if (phone.length !== 10) {
            alert('Please enter a valid 10-digit phone number');
            return;
        }

        // Store for later
        currentRegistration = { name, email, phone, ticketType, amount };

        // If free ticket, register directly
        if (amount === 0) {
            loadingOverlay.classList.add('active');
            await registerUser(currentRegistration);
            loadingOverlay.classList.remove('active');
            return;
        }

        // Show payment modal with amount
        document.getElementById('modalAmount').textContent = `₹${amount}`;
        document.getElementById('paymentModal').classList.add('active');
    });
}

// Modal handling
function initModals() {
    const paymentModal = document.getElementById('paymentModal');
    const successModal = document.getElementById('successModal');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Cancel payment
    const cancelBtn = document.getElementById('cancelPaymentBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            paymentModal.classList.remove('active');
        });
    }

    // I have paid button
    const paidBtn = document.getElementById('paidBtn');
    if (paidBtn) {
        paidBtn.addEventListener('click', async () => {
            paymentModal.classList.remove('active');
            loadingOverlay.classList.add('active');
            await registerUser(currentRegistration);
            loadingOverlay.classList.remove('active');
        });
    }

    // Close success modal
    const closeBtn = document.getElementById('closeModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            successModal.classList.remove('active');
            // Reset form
            document.getElementById('registrationForm').reset();
            updatePriceDisplay();
        });
    }

    // Close on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', () => {
            paymentModal.classList.remove('active');
            successModal.classList.remove('active');
        });
    });
}

// Register user (sends to backend)
async function registerUser(data) {
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Registration failed');
        }

        // Show success modal
        document.getElementById('ticketNumber').textContent = result.ticketNumber;
        document.getElementById('successModal').classList.add('active');

    } catch (error) {
        alert(error.message);
    }
}
