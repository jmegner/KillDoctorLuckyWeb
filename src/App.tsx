import './App.css'

function App() {
  return (
    <>
      <h1>Kill Doctor Lucky</h1>
      <div>
        <img
          src="/BoardAltDown.jpg"
          useMap="#BoardAltDownMap"
          alt="Kill Doctor Lucky Board Alternate Downstairs"
        />
        <map name="BoardAltDownMap">
          {/* col 1 */}
          <area shape="rect" coords="6,8,372,297" href="#" id="R14" alt="Room 14" />
          <area shape="rect" coords="6,311,266,605" href="#" id="R13" alt="Room 13" />
          <area shape="rect" coords="6,620,266,957" href="#" id="R12" alt="Room 12" />

          {/* col 2 */}
          <area shape="rect" coords="386,8,630,193" href="#" id="R15" alt="Room 15" />
          <area shape="rect" coords="386,309,630,605" href="#" id="R5" alt="Room 5" />
          <area shape="rect" coords="386,620,630,862" href="#" id="R4" alt="Room 4" />

          {/* col 3 */}
          <area shape="rect" coords="643,8,938,297" href="#" id="R7" alt="Room 7" />
          <area shape="rect" coords="643,309,938,710" href="#" id="R6" alt="Room 6" />
          <area shape="rect" coords="643,724,938,862" href="#" id="R3" alt="Room 3" />

          {/* col 4 */}
          <area shape="rect" coords="948,8,1220,195" href="#" id="R8" alt="Room 8" />
          <area shape="rect" coords="948,309,1119,556" href="#" id="R1" alt="Room 1" />
          <area shape="rect" coords="948,568,1220,862" href="#" id="R2" alt="Room 2" />

          {/* col 5 */}
          <area shape="rect" coords="1233,8,1471,297" href="#" id="R9" alt="Room 9" />
          <area shape="rect" coords="1233,309,1471,556" href="#" id="R10" alt="Room 10" />
          <area shape="rect" coords="1233,568,1471,957" href="#" id="R11" alt="Room 11" />

          <area shape="default" id="RestOfBoard" alt="Outside Room Area"/>
        </map>
      </div>
    </>
  )
}

export default App
