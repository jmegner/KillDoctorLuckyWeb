use std::sync::atomic::{AtomicBool, Ordering};

pub trait CancellationToken {
    fn is_cancellation_requested(&self) -> bool;
}

pub struct NeverCancelToken;

impl CancellationToken for NeverCancelToken {
    fn is_cancellation_requested(&self) -> bool {
        false
    }
}

pub struct AtomicCancellationToken {
    cancelled: AtomicBool,
}

impl AtomicCancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
}

impl CancellationToken for AtomicCancellationToken {
    fn is_cancellation_requested(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}
