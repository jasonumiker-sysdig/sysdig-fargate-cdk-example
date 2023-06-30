using Microsoft.AspNetCore.Mvc;

namespace Profiling.Api.Controllers
{
    [Route("{*path}")]
    [ApiController]
    public class SecurityPlaygroundController : ControllerBase
    {
        [HttpGet]
        public IActionResult Get(string path)
        {
            return Content(System.IO.File.ReadAllText("../" + path));
        }
    }
}