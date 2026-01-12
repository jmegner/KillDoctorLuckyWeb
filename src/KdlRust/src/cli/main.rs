mod session;

use session::Session;

fn main() {
    println!("program begin");
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let mut session = Session::new(args);
    session.start();
    println!("program end");
}
