mod session;

use session::Session;

pub const DATA_DIR: &str = "../../reference_code/KdlCSharp/Kdl.Core/Data";

fn main() {
    println!("program begin");
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let mut session = Session::new(args);
    session.start();
    println!("program end");
}
