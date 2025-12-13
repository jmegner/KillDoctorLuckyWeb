import { getANumber } from '@/KdlRust/pkg/kill_doctor_lucky_rust';

function Fiddle() {
  return (
    <>
      <button onClick={() => alert(getANumber())}>hi</button>
    </>
  );
}

export default Fiddle;
